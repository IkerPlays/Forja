/*
 * Forja3DS — agente homebrew para Nintendo 3DS.
 *
 * Se conecta a internet (WiFi) y habla con tu proyecto de Supabase:
 *   · lee la URL y la clave PÚBLICAS de la web (/forja-config.json) — sin config.txt,
 *   · entra con una cuenta anónima y se EMPAREJA con un código que escribes en la web,
 *   · avisa de que está viva (device_heartbeat), reclama órdenes (device_command_claim)
 *     y devuelve resultados (device_command_finish),
 *   · mueve archivos por trozos a través de Supabase Storage (bucket "transfers").
 * Así la web puede ver y gestionar la tarjeta SD sin PC ni "bridge", desde cualquier red.
 *
 * Interfaz gráfica con citro2d; toda la red va en un hilo aparte para que la pantalla no se congele.
 * Opcional: sdmc:/3ds/forja/config.txt (site=, url=, anon=; o email/password/device = modo clásico).
 * La sesión se guarda en sdmc:/3ds/forja/session.txt.
 */
#include <3ds.h>
#include <citro2d.h>
#include <dirent.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <math.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <curl/curl.h>
#include "cacert.h"

#ifndef VERSION
#define VERSION "dev"
#endif
#define CONFIG_PATH "sdmc:/3ds/forja/config.txt"
#define SESSION_PATH "sdmc:/3ds/forja/session.txt"
#ifndef DEFAULT_SITE
#define DEFAULT_SITE "https://forja-hub.netlify.app"
#endif
/* La CI integra aquí la URL y la clave PÚBLICAS de Supabase (así no hace falta pasar por la web) */
#ifndef DEFAULT_URL
#define DEFAULT_URL ""
#endif
#ifndef DEFAULT_ANON
#define DEFAULT_ANON ""
#endif
#define PART_SIZE (256 * 1024)   /* trozo al subir al servidor (la web acepta cualquier tamaño) */
#define MAX_FILE (50u * 1024u * 1024u)
#define MAX_ENTRIES 2000
#define NO_NETWORK ((u32)-1000)   /* sin WiFi */

static char g_url[256], g_anon[512], g_email[160], g_pass[160], g_device[64];
static char g_site[200], g_refresh[1024];
static char g_token[4096];
static time_t g_token_at = 0;
static u32 g_last_status;
static Result g_cfg_rc, g_net_rc;      /* negativo = fallo de red (-código de curl) */
static char g_self[200];               /* ruta del .3dsx si se abrió desde el Homebrew Launcher */
static char g_notice[100];
static int g_ip_open;                  /* teclado numérico propio para la IP (solo hilo principal) */
static char g_ip_buf[32];
static char g_relay_saved[100], g_manual_ip[48];
static int g_manual_new;          /* último fallo de red al leer la configuración */
static int g_relay;             /* 1 = hablando con la app de escritorio por HTTP en la WiFi local */
static u32 *g_soc_buf;
static char g_last_err[120];

/* ------------------------------------------------------------------ */
/* Estado compartido hilo de red <-> interfaz                          */
/* ------------------------------------------------------------------ */
typedef enum { ST_BOOT, ST_CONFIG, ST_AUTH, ST_PAIR, ST_RUN, ST_ERROR } State;
typedef struct { char text[64]; int result; /* 0 en curso, 1 ok, 2 error */ } Act;

static LightLock g_lock;
static State g_state = ST_BOOT;
static char g_status[200] = "Iniciando…";
static char g_code[16];
static Act g_acts[5];
static int g_nacts, g_done;
static char g_prog_label[48];
static int g_prog_up, g_prog_cur, g_prog_total;
static u32 g_diag[2] = {0xFFFFFFFFu, 0xFFFFFFFFu};   /* A: sin verificar, B: con CAs; FFFFFFFF = sin probar */
static volatile int g_quit;

static void set_state(State s, const char *msg) {
  LightLock_Lock(&g_lock);
  g_state = s;
  if (msg) snprintf(g_status, sizeof g_status, "%s", msg);
  LightLock_Unlock(&g_lock);
}
static void set_error(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void set_error(const char *fmt, ...) {
  char tmp[200];
  va_list ap; va_start(ap, fmt); vsnprintf(tmp, sizeof tmp, fmt, ap); va_end(ap);
  set_state(ST_ERROR, tmp);
}
static void set_notice(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void set_notice(const char *fmt, ...) {
  char tmp[100];
  va_list ap; va_start(ap, fmt); vsnprintf(tmp, sizeof tmp, fmt, ap); va_end(ap);
  LightLock_Lock(&g_lock);
  snprintf(g_notice, sizeof g_notice, "%s", tmp);
  LightLock_Unlock(&g_lock);
}
static const char *rc_text(Result rc, char *buf, size_t cap) {
  if ((u32)rc == NO_NETWORK) snprintf(buf, cap, "Sin conexión WiFi. Comprueba la red de la consola.");
  else if (rc < 0) snprintf(buf, cap, "No se pudo conectar: %s (código %d)", curl_easy_strerror((CURLcode)(-rc)), (int)-rc);
  else snprintf(buf, cap, "Error de red (%d)", (int)rc);
  return buf;
}
static const char *friendly(const char *type) {
  if (!strcmp(type, "list_dir")) return "Listar carpeta";
  if (!strcmp(type, "get_file")) return "Enviar archivo";
  if (!strcmp(type, "put_file")) return "Recibir archivo";
  if (!strcmp(type, "mkdir")) return "Crear carpeta";
  if (!strcmp(type, "rename")) return "Renombrar";
  if (!strcmp(type, "delete")) return "Eliminar";
  return type;
}
static void act_begin(const char *type, const char *path) {
  LightLock_Lock(&g_lock);
  for (int i = 4; i > 0; i--) g_acts[i] = g_acts[i - 1];
  snprintf(g_acts[0].text, sizeof g_acts[0].text, "%s  %s", friendly(type), path);
  g_acts[0].result = 0;
  if (g_nacts < 5) g_nacts++;
  LightLock_Unlock(&g_lock);
}
static void act_end(int ok) {
  LightLock_Lock(&g_lock);
  g_acts[0].result = ok ? 1 : 2;
  g_done++;
  LightLock_Unlock(&g_lock);
}
/* up=1 subiendo (3DS → web), up=0 recibiendo; label NULL = sin transferencia */
static void set_progress(const char *label, int up, int cur, int total) {
  LightLock_Lock(&g_lock);
  if (!label) { g_prog_total = 0; g_prog_label[0] = 0; }
  else { snprintf(g_prog_label, sizeof g_prog_label, "%s", label); g_prog_up = up; g_prog_cur = cur; g_prog_total = total; }
  LightLock_Unlock(&g_lock);
}

/* ------------------------------------------------------------------ */
/* Cadenas / JSON mínimo                                               */
/* ------------------------------------------------------------------ */
typedef struct { char *p; size_t len, cap; } Buf;

static int buf_reserve(Buf *b, size_t extra) {
  if (b->len + extra + 1 <= b->cap) return 1;
  size_t nc = b->cap ? b->cap : 256;
  while (nc < b->len + extra + 1) nc *= 2;
  char *np = realloc(b->p, nc);
  if (!np) return 0;
  b->p = np; b->cap = nc;
  return 1;
}
static void buf_add(Buf *b, const char *s, size_t n) {
  if (!buf_reserve(b, n)) return;
  memcpy(b->p + b->len, s, n); b->len += n; b->p[b->len] = 0;
}
static void buf_str(Buf *b, const char *s) { buf_add(b, s, strlen(s)); }
static void buf_printf(Buf *b, const char *fmt, ...) {
  char tmp[512];
  va_list ap; va_start(ap, fmt);
  int n = vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  if (n > 0) buf_add(b, tmp, (size_t)(n < (int)sizeof tmp ? n : (int)sizeof tmp - 1));
}
/* Añade s como cadena JSON (con comillas y escapes) */
static void buf_json_str(Buf *b, const char *s) {
  buf_add(b, "\"", 1);
  for (const unsigned char *c = (const unsigned char *)s; *c; c++) {
    switch (*c) {
      case '"': buf_str(b, "\\\""); break;
      case '\\': buf_str(b, "\\\\"); break;
      case '\n': buf_str(b, "\\n"); break;
      case '\r': buf_str(b, "\\r"); break;
      case '\t': buf_str(b, "\\t"); break;
      default:
        if (*c < 0x20) buf_printf(b, "\\u%04x", *c);
        else buf_add(b, (const char *)c, 1);
    }
  }
  buf_add(b, "\"", 1);
}

/* Devuelve un puntero al valor tras  "key" : , o NULL si no existe */
static const char *json_find(const char *j, const char *key) {
  char pat[64];
  snprintf(pat, sizeof pat, "\"%s\"", key);
  const char *p = j;
  while ((p = strstr(p, pat)) != NULL) {
    const char *q = p + strlen(pat);
    while (*q == ' ' || *q == '\n' || *q == '\t') q++;
    if (*q == ':') {
      q++;
      while (*q == ' ' || *q == '\n' || *q == '\t') q++;
      return q;
    }
    p += strlen(pat);
  }
  return NULL;
}

static int hexv(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
static void put_utf8(char **o, char *end, unsigned cp) {
  if (cp < 0x80) { if (*o + 1 < end) *(*o)++ = (char)cp; }
  else if (cp < 0x800) { if (*o + 2 < end) { *(*o)++ = (char)(0xC0 | (cp >> 6)); *(*o)++ = (char)(0x80 | (cp & 0x3F)); } }
  else if (cp < 0x10000) { if (*o + 3 < end) { *(*o)++ = (char)(0xE0 | (cp >> 12)); *(*o)++ = (char)(0x80 | ((cp >> 6) & 0x3F)); *(*o)++ = (char)(0x80 | (cp & 0x3F)); } }
  else { if (*o + 4 < end) { *(*o)++ = (char)(0xF0 | (cp >> 18)); *(*o)++ = (char)(0x80 | ((cp >> 12) & 0x3F)); *(*o)++ = (char)(0x80 | ((cp >> 6) & 0x3F)); *(*o)++ = (char)(0x80 | (cp & 0x3F)); } }
}

/* Lee una cadena JSON (desescapada, UTF-8) en out. Devuelve 1 si existe. */
static int json_get_str(const char *j, const char *key, char *out, size_t cap) {
  const char *p = json_find(j, key);
  if (!p || *p != '"') { if (cap) out[0] = 0; return 0; }
  p++;
  char *o = out, *end = out + cap - 1;
  while (*p && *p != '"') {
    if (*p == '\\') {
      p++;
      switch (*p) {
        case 'n': if (o < end) *o++ = '\n'; p++; break;
        case 'r': if (o < end) *o++ = '\r'; p++; break;
        case 't': if (o < end) *o++ = '\t'; p++; break;
        case 'b': case 'f': p++; break;
        case 'u': {
          unsigned cp = 0;
          for (int i = 1; i <= 4; i++) { int h = hexv(p[i]); if (h < 0) { cp = '?'; break; } cp = cp * 16 + (unsigned)h; }
          p += 5;
          if (cp >= 0xD800 && cp < 0xDC00 && p[0] == '\\' && p[1] == 'u') {
            unsigned lo = 0;
            for (int i = 2; i <= 5; i++) { int h = hexv(p[i]); lo = lo * 16 + (unsigned)(h < 0 ? 0 : h); }
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            p += 6;
          }
          put_utf8(&o, end, cp);
          break;
        }
        default: if (*p && o < end) *o++ = *p; if (*p) p++;
      }
    } else if (o < end) *o++ = *p++;
    else p++;
  }
  *o = 0;
  return 1;
}
static long long json_get_num(const char *j, const char *key, long long dflt) {
  const char *p = json_find(j, key);
  if (!p || !(*p == '-' || (*p >= '0' && *p <= '9'))) return dflt;
  return strtoll(p, NULL, 10);
}

/* ------------------------------------------------------------------ */
/* HTTP/TLS con libcurl + mbedTLS                                      */
/* El SSL del sistema de la 3DS solo llega a TLS 1.1 (3dbrew), y Netlify/Supabase exigen TLS 1.2+:  */
/* por eso httpc nunca podía conectar. Aquí el TLS va dentro de la app.                              */
/* ------------------------------------------------------------------ */
typedef struct { u8 *data; size_t len, cap; u32 status; } Resp;
typedef int HttpMethod;
#define M_GET 0
#define M_POST 1

static void resp_free(Resp *r) { free(r->data); r->data = NULL; r->len = r->cap = 0; }

static CURL *g_curl;
static int g_tls_mode = 0;   /* 0 = verificado con las CAs incluidas; 1 = sin verificar (reloj mal, CA nueva…) */

static int soc_up(void) {
  if (g_soc_buf) return 1;
  g_soc_buf = memalign(0x1000, 0x100000);
  if (!g_soc_buf) return 0;
  if (R_FAILED(socInit(g_soc_buf, 0x100000))) { free(g_soc_buf); g_soc_buf = NULL; return 0; }
  return 1;
}

static int net_init(void) {
  if (!soc_up()) return 0;
  curl_global_init(CURL_GLOBAL_DEFAULT);
  g_curl = curl_easy_init();
  return g_curl != NULL;
}

static size_t on_write(char *p, size_t sz, size_t n, void *ud) {
  Resp *r = ud;
  size_t k = sz * n;
  if (r->len + k + 1 > r->cap) {
    size_t nc = r->cap ? r->cap : 4096;
    while (nc < r->len + k + 1) nc *= 2;
    u8 *np = realloc(r->data, nc);
    if (!np) return 0;
    r->data = np; r->cap = nc;
  }
  memcpy(r->data + r->len, p, k);
  r->len += k;
  r->data[r->len] = 0;
  return k;
}

static int is_tls_error(int cc) {
  return cc == 35 || cc == 51 || cc == 58 || cc == 59 || cc == 60 || cc == 64 || cc == 66 || cc == 77 || cc == 83;
}

/* hdrs: pares nombre,valor terminados en NULL. Devuelve 0 o -(código de curl). */
static int http_once(HttpMethod method, const char *url, const char *const *hdrs,
                     const void *body, u32 body_len, Resp *out, int mode) {
  memset(out, 0, sizeof *out);
  if (!g_curl) return -(int)CURLE_FAILED_INIT;
  curl_easy_reset(g_curl);
  curl_easy_setopt(g_curl, CURLOPT_URL, url);
  curl_easy_setopt(g_curl, CURLOPT_WRITEFUNCTION, on_write);
  curl_easy_setopt(g_curl, CURLOPT_WRITEDATA, out);
  curl_easy_setopt(g_curl, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(g_curl, CURLOPT_CONNECTTIMEOUT, 15L);
  curl_easy_setopt(g_curl, CURLOPT_TIMEOUT, 150L);
  curl_easy_setopt(g_curl, CURLOPT_USERAGENT, "Forja3DS/" VERSION);
  if (mode == 0) {
    struct curl_blob blob;
    blob.data = (void *)g_ca_pem;
    blob.len = sizeof g_ca_pem - 1;
    blob.flags = CURL_BLOB_NOCOPY;
    curl_easy_setopt(g_curl, CURLOPT_CAINFO_BLOB, &blob);
  } else {
    curl_easy_setopt(g_curl, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(g_curl, CURLOPT_SSL_VERIFYHOST, 0L);
  }
  if (method == M_POST) {
    curl_easy_setopt(g_curl, CURLOPT_POST, 1L);
    curl_easy_setopt(g_curl, CURLOPT_POSTFIELDS, body ? (const char *)body : "");
    curl_easy_setopt(g_curl, CURLOPT_POSTFIELDSIZE, (long)body_len);
  }
  struct curl_slist *h = NULL;
  for (int i = 0; hdrs && hdrs[i]; i += 2) {
    size_t need = strlen(hdrs[i]) + strlen(hdrs[i + 1]) + 4;
    char *line = malloc(need);
    if (!line) continue;
    snprintf(line, need, "%s: %s", hdrs[i], hdrs[i + 1]);
    h = curl_slist_append(h, line);
    free(line);
  }
  h = curl_slist_append(h, "Expect:");   /* sin 100-continue */
  curl_easy_setopt(g_curl, CURLOPT_HTTPHEADER, h);
  CURLcode cc = curl_easy_perform(g_curl);
  long code = 0;
  curl_easy_getinfo(g_curl, CURLINFO_RESPONSE_CODE, &code);
  out->status = (u32)code;
  curl_slist_free_all(h);
  if (cc != CURLE_OK) { resp_free(out); return -(int)cc; }
  if (!out->data) out->data = calloc(1, 1);
  return 0;
}

static int http_do(HttpMethod method, const char *url, const char *const *hdrs,
                   const void *body, u32 body_len, Resp *out) {
  int first = g_tls_mode;
  int rc = http_once(method, url, hdrs, body, body_len, out, first);
  g_diag[first] = rc ? (u32)(-rc) : 0;
  if (rc && is_tls_error(-rc)) {
    int rc2 = http_once(method, url, hdrs, body, body_len, out, !first);
    g_diag[!first] = rc2 ? (u32)(-rc2) : 0;
    if (!rc2) { g_tls_mode = !first; return 0; }
  }
  if (rc && osGetWifiStrength() == 0) return (int)NO_NETWORK;
  return rc;
}

/* ---- sesión ---- */
static void save_session(void) {
  mkdir("sdmc:/3ds", 0777);
  mkdir("sdmc:/3ds/forja", 0777);
  FILE *f = fopen(SESSION_PATH, "w");
  if (!f) return;
  fprintf(f, "refresh=%s\ndevice=%s\nrelay=%s\n", g_refresh, g_device, g_relay_saved);
  fclose(f);
}

static void trim(char *s);

static void load_session(void) {
  FILE *f = fopen(SESSION_PATH, "r");
  if (!f) return;
  char line[1400];
  while (fgets(line, sizeof line, f)) {
    trim(line);
    if (!strncmp(line, "refresh=", 8)) snprintf(g_refresh, sizeof g_refresh, "%s", line + 8);
    else if (!strncmp(line, "device=", 7)) snprintf(g_device, sizeof g_device, "%s", line + 7);
    else if (!strncmp(line, "relay=", 6)) snprintf(g_relay_saved, sizeof g_relay_saved, "%s", line + 6);
  }
  fclose(f);
}

/* POST a /auth/v1/...; si va bien guarda los tokens y devuelve 1 */
static int auth_call(const char *path, const char *body) {
  char url[400];
  snprintf(url, sizeof url, "%s%s", g_url, path);
  const char *hdrs[] = {"apikey", g_anon, "Content-Type", "application/json", NULL};
  Resp r;
  Result rc = http_do(M_POST, url, hdrs, body, (u32)strlen(body), &r);
  g_last_status = 0;
  g_net_rc = rc;
  if (R_FAILED(rc)) { char m[120]; set_error("%s", rc_text(rc, m, sizeof m)); return 0; }
  g_last_status = r.status;
  if (r.status != 200) {
    char msg[100] = "";
    json_get_str((char *)r.data, "msg", msg, sizeof msg);
    if (!msg[0]) json_get_str((char *)r.data, "error_description", msg, sizeof msg);
    if (strstr(msg, "nonymous")) set_error("Activa «Allow anonymous sign-ins» en Supabase (Authentication → Providers)");
    else set_error("Error de inicio de sesión (%lu): %.60s", (unsigned long)r.status, msg);
    resp_free(&r);
    return 0;
  }
  char refresh[sizeof g_refresh];
  int ok = json_get_str((char *)r.data, "access_token", g_token, sizeof g_token);
  if (ok && json_get_str((char *)r.data, "refresh_token", refresh, sizeof refresh)) {
    snprintf(g_refresh, sizeof g_refresh, "%s", refresh);
    save_session();                      /* el refresh token rota en cada uso: guardarlo siempre */
  }
  resp_free(&r);
  if (!ok) { set_error("Respuesta de inicio de sesión no válida"); return 0; }
  g_token_at = time(NULL);
  return 1;
}

static int login(void) {
  if (g_email[0] && g_pass[0]) {          /* modo clásico (config.txt con email y contraseña) */
    Buf b = {0};
    buf_str(&b, "{\"email\":"); buf_json_str(&b, g_email);
    buf_str(&b, ",\"password\":"); buf_json_str(&b, g_pass);
    buf_str(&b, "}");
    int ok = auth_call("/auth/v1/token?grant_type=password", b.p ? b.p : "{}");
    free(b.p);
    return ok;
  }
  if (g_refresh[0]) {
    Buf b = {0};
    buf_str(&b, "{\"refresh_token\":"); buf_json_str(&b, g_refresh);
    buf_str(&b, "}");
    int ok = auth_call("/auth/v1/token?grant_type=refresh_token", b.p ? b.p : "{}");
    free(b.p);
    if (ok) return 1;
    if (g_last_status >= 400 && g_last_status < 500) {   /* sesión inválida: empezar de cero */
      g_refresh[0] = 0; g_device[0] = 0; remove(SESSION_PATH);
    } else return 0;                                       /* sin red: reintentar luego */
  }
  return auth_call("/auth/v1/signup", "{}");               /* cuenta anónima nueva */
}

/* Petición autenticada; reintenta una vez si el token caducó */
static Result api(HttpMethod m, const char *path, const char *ctype, const void *body, u32 blen, Resp *out) {
  char url[512], auth[sizeof g_token + 16];
  snprintf(url, sizeof url, "%s%s", g_url, path);
  for (int attempt = 0; attempt < 2; attempt++) {
    if (time(NULL) - g_token_at > 45 * 60 && !login()) return -2;
    snprintf(auth, sizeof auth, "Bearer %s", g_token);
    const char *hdrs[] = {"apikey", g_anon, "Authorization", auth, "Content-Type", ctype ? ctype : "application/json",
                          "x-upsert", "true", NULL};
    Result rc = http_do(m, url, hdrs, body, blen, out);
    if (R_FAILED(rc)) return rc;
    if (out->status == 401 && attempt == 0) { resp_free(out); g_token_at = 0; continue; }
    return 0;
  }
  return -3;
}

static int rpc(const char *fn, const char *json_body, Resp *out) {
  char path[128];
  snprintf(path, sizeof path, "/rest/v1/rpc/%s", fn);
  Result rc = api(M_POST, path, "application/json", json_body, (u32)strlen(json_body), out);
  g_last_err[0] = 0; g_last_status = 0;
  if (R_FAILED(rc)) return 0;
  g_last_status = out->status;
  if (out->status >= 300) {
    json_get_str((char *)out->data, "message", g_last_err, sizeof g_last_err);
    resp_free(out);
    return 0;
  }
  return 1;
}

/* ------------------------------------------------------------------ */
/* Archivos                                                            */
/* ------------------------------------------------------------------ */
/* "/3ds/x" -> "sdmc:/3ds/x"; rechaza ".." */
static int sd_path(const char *vp, char *out, size_t cap) {
  if (!vp || !*vp) vp = "/";
  if (strstr(vp, "/../") || strstr(vp, "/..") == vp + strlen(vp) - 3 || !strcmp(vp, "..") || strstr(vp, "../") == vp) return 0;
  snprintf(out, cap, "sdmc:%s%s", vp[0] == '/' ? "" : "/", vp);
  return 1;
}

static int cmd_list_dir(const char *vpath, Buf *res, char *err, size_t errcap) {
  char p[600];
  if (!sd_path(vpath, p, sizeof p)) { snprintf(err, errcap, "Ruta no valida"); return 0; }
  DIR *d = opendir(p);
  if (!d) { snprintf(err, errcap, "No se pudo abrir la carpeta"); return 0; }
  buf_str(res, "{\"entries\":[");
  int n = 0;
  struct dirent *e;
  while ((e = readdir(d)) != NULL && n < MAX_ENTRIES) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char full[900];
    snprintf(full, sizeof full, "%s/%s", p, e->d_name);
    struct stat st;
    if (stat(full, &st) != 0) continue;
    if (n++) buf_str(res, ",");
    buf_str(res, "{\"name\":"); buf_json_str(res, e->d_name);
    int isdir = S_ISDIR(st.st_mode);
    buf_printf(res, ",\"type\":\"%s\",\"size\":%lld,\"mtime\":%lld}", isdir ? "dir" : "file",
               isdir ? 0LL : (long long)st.st_size, (long long)st.st_mtime * 1000LL);
  }
  closedir(d);
  buf_printf(res, "],\"truncated\":%s}", n >= MAX_ENTRIES ? "true" : "false");
  return 1;
}

static const char *base_name(const char *p) {
  const char *s = strrchr(p, '/');
  return s ? s + 1 : p;
}

static int cmd_get_file(const char *vpath, const char *studio, const char *cmd_id, Buf *res, char *err, size_t errcap) {
  char p[600];
  if (!sd_path(vpath, p, sizeof p)) { snprintf(err, errcap, "Ruta no valida"); return 0; }
  struct stat st;
  if (stat(p, &st) != 0 || !S_ISREG(st.st_mode)) { snprintf(err, errcap, "No es un archivo"); return 0; }
  if ((unsigned long long)st.st_size > MAX_FILE) { snprintf(err, errcap, "El archivo supera los 50 MB"); return 0; }
  FILE *f = fopen(p, "rb");
  if (!f) { snprintf(err, errcap, "No se pudo leer el archivo"); return 0; }
  u8 *chunk = malloc(PART_SIZE);
  if (!chunk) { fclose(f); snprintf(err, errcap, "Sin memoria"); return 0; }
  int parts = (int)((st.st_size + PART_SIZE - 1) / PART_SIZE);
  if (parts < 1) parts = 1;
  int ok = 1;
  for (int i = 0; i < parts && ok; i++) {
    size_t n = fread(chunk, 1, PART_SIZE, f);
    char path[400];
    snprintf(path, sizeof path, "/storage/v1/object/transfers/%s/%s/%s.p%d", studio, g_device, cmd_id, i);
    set_progress(base_name(p), 1, i, parts);
    Resp r;
    Result rc = api(M_POST, path, "application/octet-stream", chunk, (u32)n, &r);
    if (R_FAILED(rc) || r.status >= 300) { snprintf(err, errcap, "Fallo al subir (HTTP %lu)", R_FAILED(rc) ? 0UL : (unsigned long)r.status); ok = 0; }
    if (!R_FAILED(rc)) resp_free(&r);
  }
  free(chunk); fclose(f);
  set_progress(NULL, 0, 0, 0);
  if (!ok) return 0;
  buf_printf(res, "{\"storage\":\"%s/%s/%s\",\"parts\":%d,\"size\":%lld}", studio, g_device, cmd_id, parts, (long long)st.st_size);
  return 1;
}

static int cmd_put_file(const char *vpath, const char *prefix, int parts, char *err, size_t errcap) {
  char p[600];
  if (!sd_path(vpath, p, sizeof p)) { snprintf(err, errcap, "Ruta no valida"); return 0; }
  FILE *f = fopen(p, "wb");
  if (!f) { snprintf(err, errcap, "No se pudo crear el archivo"); return 0; }
  int ok = 1;
  for (int i = 0; i < parts && ok; i++) {
    char path[400];
    snprintf(path, sizeof path, "/storage/v1/object/authenticated/transfers/%s.p%d", prefix, i);
    set_progress(base_name(p), 0, i, parts);
    Resp r;
    Result rc = api(M_GET, path, NULL, NULL, 0, &r);
    if (R_FAILED(rc) || r.status != 200) { snprintf(err, errcap, "Fallo al descargar (HTTP %lu)", R_FAILED(rc) ? 0UL : (unsigned long)r.status); ok = 0; }
    if (!R_FAILED(rc)) {
      if (ok && fwrite(r.data, 1, r.len, f) != r.len) { snprintf(err, errcap, "Error al escribir en la SD (llena?)"); ok = 0; }
      resp_free(&r);
    }
  }
  fclose(f);
  set_progress(NULL, 0, 0, 0);
  if (!ok) remove(p);
  return ok;
}

static int rm_rf(const char *p) {
  struct stat st;
  if (stat(p, &st) != 0) return -1;
  if (!S_ISDIR(st.st_mode)) return remove(p);
  DIR *d = opendir(p);
  if (!d) return -1;
  struct dirent *e;
  int rc = 0;
  while ((e = readdir(d)) != NULL) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char full[900];
    snprintf(full, sizeof full, "%s/%s", p, e->d_name);
    if (rm_rf(full) != 0) rc = -1;
  }
  closedir(d);
  return rc == 0 ? rmdir(p) : -1;
}

static void finish(const char *id, int ok, const char *result_json, const char *err) {
  Buf b = {0};
  buf_str(&b, "{\"p_id\":"); buf_json_str(&b, id);
  buf_printf(&b, ",\"p_status\":\"%s\"", ok ? "done" : "error");
  if (ok) { buf_str(&b, ",\"p_result\":"); buf_str(&b, result_json && *result_json ? result_json : "{}"); }
  else { buf_str(&b, ",\"p_error\":"); buf_json_str(&b, err && *err ? err : "Error"); }
  buf_str(&b, "}");
  Resp r;
  if (rpc("device_command_finish", b.p ? b.p : "{}", &r)) resp_free(&r);
  free(b.p);
}

static void handle(const char *json, char *last, size_t lastcap) {
  char id[64], studio[64], type[32], path[600], to[600], storage[300], kind[16];
  json_get_str(json, "id", id, sizeof id);
  json_get_str(json, "studio_id", studio, sizeof studio);
  json_get_str(json, "type", type, sizeof type);
  json_get_str(json, "path", path, sizeof path);
  json_get_str(json, "to", to, sizeof to);
  json_get_str(json, "storage", storage, sizeof storage);
  json_get_str(json, "kind", kind, sizeof kind);
  int parts = (int)json_get_num(json, "parts", 0);
  (void)last; (void)lastcap;
  act_begin(type, path);

  Buf res = {0};
  char err[160] = "";
  int ok = 0;
  if (!strcmp(type, "list_dir")) ok = cmd_list_dir(path, &res, err, sizeof err);
  else if (!strcmp(type, "get_file")) ok = cmd_get_file(path, studio, id, &res, err, sizeof err);
  else if (!strcmp(type, "put_file")) { ok = cmd_put_file(path, storage, parts, err, sizeof err); buf_str(&res, "{}"); }
  else if (!strcmp(type, "mkdir")) {
    char p[600];
    if (!sd_path(path, p, sizeof p)) snprintf(err, sizeof err, "Ruta no valida");
    else if (mkdir(p, 0777) == 0 || errno == EEXIST) { ok = 1; buf_str(&res, "{}"); }
    else snprintf(err, sizeof err, "No se pudo crear la carpeta");
  } else if (!strcmp(type, "rename")) {
    char a[600], b[600];
    if (!sd_path(path, a, sizeof a) || !sd_path(to, b, sizeof b)) snprintf(err, sizeof err, "Ruta no valida");
    else if (rename(a, b) == 0) { ok = 1; buf_str(&res, "{}"); }
    else snprintf(err, sizeof err, "No se pudo renombrar");
  } else if (!strcmp(type, "delete")) {
    char p[600];
    if (!sd_path(path, p, sizeof p) || !strcmp(path, "/") || path[0] == 0) snprintf(err, sizeof err, "Ruta no valida");
    else if (rm_rf(p) == 0) { ok = 1; buf_str(&res, "{}"); }
    else snprintf(err, sizeof err, "No se pudo eliminar");
  } else snprintf(err, sizeof err, "Orden desconocida: %.40s", type);

  finish(id, ok, res.p, err);
  free(res.p);
  act_end(ok);
  set_state(ST_RUN, "Conectada");
}

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */
static void trim(char *s) {
  size_t n = strlen(s);
  while (n && (s[n - 1] == '\n' || s[n - 1] == '\r' || s[n - 1] == ' ' || s[n - 1] == '\t')) s[--n] = 0;
}

/* config.txt es OPCIONAL: site=, url=, anon= (y email/password/device para el modo clásico) */
static void load_config(void) {
  FILE *f = fopen(CONFIG_PATH, "r");
  if (!f) return;
  char line[1024];
  while (fgets(line, sizeof line, f)) {
    trim(line);
    if (line[0] == '#' || !line[0]) continue;
    char *eq = strchr(line, '=');
    if (!eq) continue;
    *eq = 0;
    char *k = line, *v = eq + 1;
    if (!strcmp(k, "site")) snprintf(g_site, sizeof g_site, "%s", v);
    else if (!strcmp(k, "url")) snprintf(g_url, sizeof g_url, "%s", v);
    else if (!strcmp(k, "anon")) snprintf(g_anon, sizeof g_anon, "%s", v);
    else if (!strcmp(k, "email")) snprintf(g_email, sizeof g_email, "%s", v);
    else if (!strcmp(k, "password")) snprintf(g_pass, sizeof g_pass, "%s", v);
    else if (!strcmp(k, "device")) snprintf(g_device, sizeof g_device, "%s", v);
  }
  fclose(f);
  size_t n = strlen(g_url);
  while (n && g_url[n - 1] == '/') g_url[--n] = 0;
  n = strlen(g_site);
  while (n && g_site[n - 1] == '/') g_site[--n] = 0;
}

/* Lee la URL y la clave públicas de Supabase de la propia web de Forja */
static int fetch_site_config(void) {
  char url[300];
  snprintf(url, sizeof url, "%s/forja-config.json", g_site);
  Resp r;
  Result rc = http_do(M_GET, url, NULL, NULL, 0, &r);
  g_cfg_rc = rc;
  if (R_FAILED(rc)) { char m[120]; set_error("%s", rc_text(rc, m, sizeof m)); return 0; }
  int ok = r.status == 200 && json_get_str((char *)r.data, "url", g_url, sizeof g_url) &&
           json_get_str((char *)r.data, "anon", g_anon, sizeof g_anon);
  if (!ok) set_error("No pude leer la configuración de la web (HTTP %lu)", (unsigned long)r.status);
  resp_free(&r);
  return ok;
}

/* ------------------------------------------------------------------ */
/* Interfaz gráfica (citro2d)                                          */
/* ------------------------------------------------------------------ */
#define CLR(r, g, b) C2D_Color32((r), (g), (b), 255)
#define CLRA(r, g, b, a) C2D_Color32((r), (g), (b), (a))
#define C_BG1 CLR(0x12, 0x15, 0x1b)
#define C_BG2 CLR(0x24, 0x19, 0x10)
#define C_PANEL CLR(0x1b, 0x20, 0x29)
#define C_PANEL2 CLR(0x25, 0x2c, 0x39)
#define C_LINE CLR(0x33, 0x3b, 0x4a)
#define C_TEXT CLR(0xe8, 0xea, 0xf0)
#define C_MUTED CLR(0x8b, 0x93, 0xa5)
#define C_ORANGE CLR(0xff, 0x7a, 0x2f)
#define C_AMBER CLR(0xff, 0xb3, 0x47)
#define C_OK CLR(0x3e, 0xcf, 0x8e)
#define C_ERR CLR(0xef, 0x44, 0x44)
#define C_WARN CLR(0xf5, 0xb8, 0x3d)

static C2D_TextBuf g_tbuf;

static float text_at(const char *s, float x, float y, float sc, u32 col, u32 align) {
  C2D_Text t;
  C2D_TextParse(&t, g_tbuf, s);
  C2D_TextOptimize(&t);
  float w, h;
  C2D_TextGetDimensions(&t, sc, sc, &w, &h);
  C2D_DrawText(&t, C2D_WithColor | align, x, y, 0.0f, sc, sc, col);
  return w;
}
static void text_wrap(const char *s, float x, float y, float sc, u32 col, float width) {
  C2D_Text t;
  C2D_TextParse(&t, g_tbuf, s);
  C2D_TextOptimize(&t);
  C2D_DrawText(&t, C2D_WithColor | C2D_WordWrap, x, y, 0.0f, sc, sc, col, width);
}
static void rrect(float x, float y, float w, float h, float r, u32 c) {
  C2D_DrawRectSolid(x + r, y, 0, w - 2 * r, h, c);
  C2D_DrawRectSolid(x, y + r, 0, r, h - 2 * r, c);
  C2D_DrawRectSolid(x + w - r, y + r, 0, r, h - 2 * r, c);
  C2D_DrawCircleSolid(x + r, y + r, 0, r, c);
  C2D_DrawCircleSolid(x + w - r, y + r, 0, r, c);
  C2D_DrawCircleSolid(x + r, y + h - r, 0, r, c);
  C2D_DrawCircleSolid(x + w - r, y + h - r, 0, r, c);
}
static void card(float x, float y, float w, float h, float r) {
  rrect(x - 1, y - 1, w + 2, h + 2, r + 1, C_LINE);
  rrect(x, y, w, h, r, C_PANEL);
}
static void bg(float w, float h) { C2D_DrawRectangle(0, 0, 0, w, h, C_BG1, C_BG1, C_BG2, C_BG2); }

/* Llama sobre yunque: logo de Forja */
static void logo(float cx, float cy, float s) {
  C2D_DrawTriangle(cx, cy - 15 * s, C_AMBER, cx - 10 * s, cy + 7 * s, C_ORANGE, cx + 10 * s, cy + 7 * s, C_ORANGE, 0);
  C2D_DrawTriangle(cx, cy - 4 * s, CLR(0xff, 0xe0, 0x9a), cx - 5 * s, cy + 7 * s, C_AMBER, cx + 5 * s, cy + 7 * s, C_AMBER, 0);
  C2D_DrawRectSolid(cx - 13 * s, cy + 9 * s, 0, 26 * s, 5 * s, C_ORANGE);
  C2D_DrawRectSolid(cx - 9 * s, cy + 14 * s, 0, 18 * s, 3 * s, CLR(0xc9, 0x58, 0x1c));
}

static void spinner(float cx, float cy, float r, unsigned tick, u32 base_r, u32 base_g, u32 base_b) {
  for (int i = 0; i < 8; i++) {
    float a = (float)i * 3.14159265f / 4.0f;
    unsigned phase = (tick / 4 + 8 - (unsigned)i) % 8;
    unsigned alpha = 255 - phase * 28;
    C2D_DrawCircleSolid(cx + r * cosf(a), cy + r * sinf(a), 0, 3.2f - (float)phase * 0.2f, CLRA(base_r, base_g, base_b, alpha));
  }
}

static void wifi_bars(float x, float y) {
  int s = osGetWifiStrength();   /* 0..3 */
  for (int i = 0; i < 3; i++)
    rrect(x + i * 7, y + 12 - i * 5, 5, 6 + i * 5, 1.5f, i < s ? C_OK : C_LINE);
}

static void short_host(const char *url, char *out, size_t cap) {
  const char *p = strstr(url, "://");
  p = p ? p + 3 : url;
  snprintf(out, cap, "%s", p);
}

static void draw_top(unsigned tick, State st, const char *status, const char *code, int done, int pl, int pcur, int ptotal, const char *plabel, int pup) {
  bg(400, 240);
  logo(32, 30, 1.0f);
  text_at("Forja", 54, 10, 0.85f, C_TEXT, 0);
  text_at("para Nintendo 3DS", 55, 34, 0.42f, C_MUTED, 0);
  text_at("v" VERSION, 386, 16, 0.45f, C_MUTED, C2D_AlignRight);

  if (g_notice[0]) text_at(g_notice, 200, 38, 0.42f, C_AMBER, C2D_AlignCenter);
  card(16, 58, 368, 134, 10);
  switch (st) {
    case ST_PAIR: {
      text_at("Vincula esta consola", 200, 66, 0.62f, C_MUTED, C2D_AlignCenter);
      const char *c = code[0] ? code : "······";
      for (int i = 0; i < 6; i++) {
        float bx = 48 + i * 52;
        rrect(bx, 94, 44, 58, 8, C_PANEL2);
        char ch[2] = {c[i] ? c[i] : '.', 0};
        text_at(ch, bx + 22, 98, 1.45f, code[0] ? C_AMBER : C_LINE, C2D_AlignCenter);
      }
      text_at("En la web de Forja:  3DS › Añadir  y escribe el código", 200, 162, 0.46f, C_MUTED, C2D_AlignCenter);
      break;
    }
    case ST_RUN: {
      float pulse = 11.0f + 3.0f * sinf((float)tick * 0.08f);
      C2D_DrawCircleSolid(200, 96, 0, pulse + 7, CLRA(0x3e, 0xcf, 0x8e, 50));
      C2D_DrawCircleSolid(200, 96, 0, 11, C_OK);
      text_at("Conectada", 200, 114, 0.9f, C_TEXT, C2D_AlignCenter);
      if (pl) {
        char lab[96];
        snprintf(lab, sizeof lab, "%s %s  (%d/%d)", pup ? "Enviando" : "Recibiendo", plabel, pcur + 1, ptotal);
        text_at(lab, 200, 150, 0.45f, C_AMBER, C2D_AlignCenter);
        rrect(46, 170, 308, 8, 4, C_PANEL2);
        float f = ptotal ? (float)(pcur + 1) / (float)ptotal : 0;
        rrect(46, 170, 308.0f * f > 8 ? 308.0f * f : 8, 8, 4, C_ORANGE);
      } else {
        char n[64];
        if (done) snprintf(n, sizeof n, "%d %s atendidas", done, done == 1 ? "orden" : "órdenes");
        else snprintf(n, sizeof n, "Esperando órdenes desde la web…");
        text_at(n, 200, 154, 0.5f, C_MUTED, C2D_AlignCenter);
      }
      break;
    }
    case ST_ERROR:
      C2D_DrawCircleSolid(200, 90, 0, 16, C_ERR);
      text_at("!", 200, 74, 0.8f, CLR(255, 255, 255), C2D_AlignCenter);
      text_wrap(status, 40, 114, 0.5f, C_TEXT, 320);
      text_at("Reintentando automáticamente…", 200, 170, 0.42f, C_MUTED, C2D_AlignCenter);
      break;
    default:
      spinner(200, 100, 20, tick, 0xff, 0x7a, 0x2f);
      text_wrap(status, 40, 140, 0.55f, C_TEXT, 320);
      break;
  }
  rrect(136, 202, 128, 24, 12, C_PANEL2);
  text_at("START  ·  Salir", 200, 207, 0.45f, C_MUTED, C2D_AlignCenter);
}

/* Teclado numérico propio para la IP del PC (sin el teclado del sistema, que es lo que fallaba) */
static const char *KP_ROWS[3] = {"123<", "456.", "789:"};

static void ip_open(void) {
  u32 me = (u32)gethostid();   /* IP de la consola (orden de red): prerrellena la red para escribir solo el final */
  if (me) snprintf(g_ip_buf, sizeof g_ip_buf, "%u.%u.%u.", (unsigned)(me & 0xFF), (unsigned)((me >> 8) & 0xFF), (unsigned)((me >> 16) & 0xFF));
  else g_ip_buf[0] = 0;
  g_ip_open = 1;
}

static void ip_tap(int px, int py) {
  for (int r = 0; r < 4; r++) {
    for (int c = 0; c < 4; c++) {
      if (r == 3 && c == 3) continue;
      int x = 8 + c * 78, y = 70 + r * 42, w = (r == 3 && c == 2) ? 148 : 70, h = 36;
      if (px < x || px >= x + w || py < y || py >= y + h) continue;
      size_t n = strlen(g_ip_buf);
      if (r < 3) {
        char k = KP_ROWS[r][c];
        if (k == '<') { if (n) g_ip_buf[n - 1] = 0; }
        else if (n < 21) { g_ip_buf[n] = k; g_ip_buf[n + 1] = 0; }
      } else if (c == 1) {
        if (n < 21) { g_ip_buf[n] = '0'; g_ip_buf[n + 1] = 0; }
      } else if (c == 0) {
        g_ip_open = 0;
      } else if (c == 2) {
        if (n >= 7 && strchr(g_ip_buf, '.')) {
          LightLock_Lock(&g_lock); snprintf(g_manual_ip, sizeof g_manual_ip, "%s", g_ip_buf); g_manual_new = 1; LightLock_Unlock(&g_lock);
          g_ip_open = 0;
        }
      }
      return;
    }
  }
}

static void draw_keypad(unsigned tick) {
  C2D_DrawRectangle(0, 0, 0, 320, 240, C_PANEL, C_PANEL, C_BG1, C_BG1);
  rrect(8, 12, 304, 46, 8, C_PANEL2);
  char shown[40];
  snprintf(shown, sizeof shown, "%s%s", g_ip_buf, (tick / 30) % 2 ? "|" : "");
  text_at(shown[0] ? shown : "192.168.1.20", 20, 18, 0.95f, g_ip_buf[0] ? C_TEXT : C_LINE, 0);
  for (int r = 0; r < 4; r++) {
    for (int c = 0; c < 4; c++) {
      if (r == 3 && c == 3) continue;
      float x = 8 + c * 78, y = 70 + r * 42, w = (r == 3 && c == 2) ? 148 : 70;
      char lab[16];
      u32 bg = C_PANEL2, fg = C_TEXT;
      if (r < 3) snprintf(lab, sizeof lab, "%c", KP_ROWS[r][c]);
      else if (c == 1) snprintf(lab, sizeof lab, "0");
      else if (c == 0) { snprintf(lab, sizeof lab, "Cancelar"); fg = C_MUTED; }
      else { snprintf(lab, sizeof lab, "Conectar"); bg = C_ORANGE; fg = CLR(0x1a, 0x0d, 0x03); }
      rrect(x, y, w, 36, 7, bg);
      text_at(lab, x + w / 2, y + 6, r == 3 && c != 1 ? 0.55f : 0.8f, fg, C2D_AlignCenter);
    }
  }
}

static void draw_bottom(State st, int nacts, const Act *acts, int pl, int pcur, int ptotal, const char *plabel, const u32 *diag) {
  C2D_DrawRectangle(0, 0, 0, 320, 240, C_PANEL, C_PANEL, C_BG1, C_BG1);
  text_at("Actividad", 16, 8, 0.7f, C_TEXT, 0);
  wifi_bars(286, 12);

  card(12, 40, 296, 46, 8);
  char host[160];
  short_host(g_url[0] ? g_url : g_site, host, sizeof host);
  text_at("SERVIDOR", 24, 45, 0.36f, C_MUTED, 0);
  text_at(host, 24, 57, 0.46f, C_TEXT, 0);
  char dev[24];
  snprintf(dev, sizeof dev, "%.8s…", g_device[0] ? g_device : "sin vincular");
  text_at("DISPOSITIVO", 214, 45, 0.36f, C_MUTED, 0);
  text_at(dev, 214, 57, 0.46f, g_device[0] ? C_TEXT : C_WARN, 0);

  float y = 96;
  if (!nacts) {
    text_at(st == ST_RUN ? "Aún no hay actividad" : "Sin actividad todavía", 160, 130, 0.5f, C_MUTED, C2D_AlignCenter);
  }
  for (int i = 0; i < nacts; i++) {
    u32 c = acts[i].result == 1 ? C_OK : acts[i].result == 2 ? C_ERR : C_AMBER;
    rrect(12, y, 296, 22, 6, i % 2 ? C_PANEL : C_PANEL2);
    C2D_DrawCircleSolid(24, y + 11, 0, 4, c);
    char line[64];
    snprintf(line, sizeof line, "%.44s", acts[i].text);
    text_at(line, 36, y + 3, 0.42f, C_TEXT, 0);
    y += 24;
  }

  if (st == ST_ERROR) {
    rrect(12, 188, 296, 36, 8, C_ORANGE);
    text_at("Escribir la IP del PC (app de escritorio)", 160, 197, 0.5f, CLR(0x1a, 0x0d, 0x03), C2D_AlignCenter);
  }
  if (pl) {
    float f = ptotal ? (float)(pcur + 1) / (float)ptotal : 0;
    text_at(plabel, 16, 214, 0.38f, C_MUTED, 0);
    rrect(16, 228, 288, 6, 3, C_PANEL2);
    rrect(16, 228, 288.0f * f > 6 ? 288.0f * f : 6, 6, 3, C_ORANGE);
  } else if (st != ST_RUN && (diag[0] != 0xFFFFFFFFu || diag[1] != 0xFFFFFFFFu) && (diag[0] || diag[1])) {
    char d[110], a1[16], b1[16];
    #define DG(v, o) (v == 0xFFFFFFFFu ? snprintf(o, sizeof o, "--") : v ? snprintf(o, sizeof o, "err %lu", (unsigned long)v) : snprintf(o, sizeof o, "ok"))
    DG(diag[0], a1); DG(diag[1], b1);
    snprintf(d, sizeof d, "TLS verificado: %s   sin verificar: %s", a1, b1);
    text_at(d, 160, 216, 0.4f, C_MUTED, C2D_AlignCenter);
  }

/* ------------------------------------------------------------------ */
/* Hilo de red                                                         */
/* ------------------------------------------------------------------ */
static void heartbeat(void) {
  Buf b = {0};
  buf_str(&b, "{\"p_device\":"); buf_json_str(&b, g_device);
  buf_str(&b, ",\"p_info\":{\"proto\":2,\"Agente\":\"Forja3DS " VERSION "\",\"Consola\":\"Nintendo 3DS\"}}");
  Resp r;
  if (rpc("device_heartbeat", b.p, &r)) resp_free(&r);
  free(b.p);
}

/* Pide (o recupera) el código de vinculación; devuelve 1 si el servidor respondió */
static int pair_poll(void) {
  Resp r;
  if (!rpc("device_pair_poll", "{}", &r)) return 0;
  char dev[64] = "", code[16] = "";
  json_get_str((char *)r.data, "device_id", dev, sizeof dev);
  json_get_str((char *)r.data, "code", code, sizeof code);
  resp_free(&r);
  LightLock_Lock(&g_lock);
  if (dev[0]) { snprintf(g_device, sizeof g_device, "%s", dev); g_code[0] = 0; }
  else snprintf(g_code, sizeof g_code, "%s", code);
  LightLock_Unlock(&g_lock);
  if (dev[0]) save_session();
  return 1;
}

/* Plan B sin TLS: busca la app de escritorio de Forja en la WiFi (UDP 8766, "FORJA?") y habla con ella en HTTP plano. */
static int relay_discover(char *out, size_t cap) {
  if (!soc_up()) return 0;
  int s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (s < 0) return 0;
  int yes = 1;
  setsockopt(s, SOL_SOCKET, SO_BROADCAST, &yes, sizeof yes);
  fcntl(s, F_SETFL, fcntl(s, F_GETFL, 0) | O_NONBLOCK);
  struct sockaddr_in a;
  memset(&a, 0, sizeof a);
  a.sin_family = AF_INET;
  a.sin_port = htons(8766);
  u32 me = (u32)gethostid();
  const u32 targets[2] = {htonl(INADDR_BROADCAST), me | htonl(0xFFu)};
  for (int attempt = 0; attempt < 4 && !g_quit; attempt++) {
    for (int t = 0; t < 2; t++) {
      a.sin_addr.s_addr = targets[t];
      sendto(s, "FORJA?", 6, 0, (struct sockaddr *)&a, sizeof a);
    }
    for (int w = 0; w < 15 && !g_quit; w++) {
      char buf[160];
      struct sockaddr_in from;
      socklen_t fl = sizeof from;
      int n = recvfrom(s, buf, sizeof buf - 1, 0, (struct sockaddr *)&from, &fl);
      if (n > 6) {
        buf[n] = 0;
        if (!strncmp(buf, "FORJA ", 6)) { snprintf(out, cap, "%s", buf + 6); close(s); return 1; }
      }
      svcSleepThread(100 * 1000 * 1000LL);
    }
  }
  close(s);
  return 0;
}

/* Plan B: dirección guardada/escrita a mano y, si no, descubrimiento por UDP. 1 = configuración leída del PC. */
static int try_relay(void) {
  char base[100];
  if (g_relay_saved[0]) {
    snprintf(g_site, sizeof g_site, "%s", g_relay_saved);
    if (fetch_site_config()) { g_relay = 1; return 1; }
  }
  if (relay_discover(base, sizeof base)) {
    snprintf(g_site, sizeof g_site, "%s", base);
    if (fetch_site_config()) { g_relay = 1; snprintf(g_relay_saved, sizeof g_relay_saved, "%s", base); save_session(); return 1; }
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Autoactualización: compara con /downloads/latest.json de la web      */
/* ------------------------------------------------------------------ */
static int semver_gt(const char *a, const char *b) {
  int x[3] = {0, 0, 0}, y[3] = {0, 0, 0};
  sscanf(a, "%d.%d.%d", &x[0], &x[1], &x[2]);
  sscanf(b, "%d.%d.%d", &y[0], &y[1], &y[2]);
  for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] > y[i];
  return 0;
}

static int install_cia(const u8 *data, size_t len) {
  if (R_FAILED(amInit())) return 0;
  Handle h;
  if (R_FAILED(AM_StartCiaInstall(MEDIATYPE_SD, &h))) { amExit(); return 0; }
  u32 written = 0;
  Result rc = FSFILE_Write(h, &written, 0, data, (u32)len, 0);
  if (R_FAILED(rc) || written != len) { AM_CancelCIAInstall(h); amExit(); return 0; }
  rc = AM_FinishCiaInstall(h);
  amExit();
  return R_SUCCEEDED(rc);
}

static void maybe_update(void) {
  if (!strcmp(VERSION, "dev") || g_relay) return;
  char url[320];
  snprintf(url, sizeof url, "%s/downloads/latest.json", g_site);
  Resp r;
  if (http_do(M_GET, url, NULL, NULL, 0, &r) != 0) return;
  char ver[24] = "";
  if (r.status == 200) json_get_str((char *)r.data, "version", ver, sizeof ver);
  resp_free(&r);
  if (!ver[0] || !semver_gt(ver, VERSION)) return;

  int hb = envIsHomebrew();
  set_notice("Actualizando a v%s…", ver);
  snprintf(url, sizeof url, "%s/downloads/%s", g_site, hb ? "Forja3DS.3dsx" : "Forja3DS.cia");
  Resp d;
  if (http_do(M_GET, url, NULL, NULL, 0, &d) != 0 || d.status != 200 || d.len < 20000) {
    if (d.data) resp_free(&d);
    set_notice("No se pudo descargar la actualización v%s", ver);
    return;
  }
  int ok = 0;
  if (hb) {
    const char *path = g_self[0] ? g_self : "sdmc:/3ds/Forja3DS.3dsx";
    char tmp[240];
    snprintf(tmp, sizeof tmp, "%s.new", path);
    if (memcmp(d.data, "3DSX", 4) == 0) {
      FILE *f = fopen(tmp, "wb");
      if (f) {
        ok = fwrite(d.data, 1, d.len, f) == d.len;
        fclose(f);
        if (ok) { remove(path); ok = rename(tmp, path) == 0; } else remove(tmp);
      }
    }
  } else {
    u32 hdr = d.len >= 4 ? (u32)d.data[0] | ((u32)d.data[1] << 8) | ((u32)d.data[2] << 16) | ((u32)d.data[3] << 24) : 0;
    if (hdr == 0x2020) ok = install_cia(d.data, d.len);
  }
  resp_free(&d);
  if (ok) set_notice("Actualizada a v%s. Reinicia la app para usarla.", ver);
  else set_notice("No se pudo instalar la actualización v%s", ver);
}

static void worker(void *arg) {
  (void)arg;
  snprintf(g_site, sizeof g_site, "%s", DEFAULT_SITE);
  snprintf(g_url, sizeof g_url, "%s", DEFAULT_URL);
  snprintf(g_anon, sizeof g_anon, "%s", DEFAULT_ANON);
  load_session();
  load_config();
  Result hrc = net_init() ? 0 : -1;
  if (hrc) set_error("No se pudo iniciar la red (sockets/TLS)");

  char dummy[8] = "";
  int fails = 0, upd_done = 0;
  int cfg_ok = g_url[0] && g_anon[0], authed = 0;
  time_t last_beat = 0, last_try = 0, last_poll = 0;

  while (!g_quit) {
    time_t now = time(NULL);

    LightLock_Lock(&g_lock);
    int manual = g_manual_new; char mip[48]; snprintf(mip, sizeof mip, "%s", g_manual_ip); g_manual_new = 0;
    LightLock_Unlock(&g_lock);
    if (manual && mip[0]) {
      snprintf(g_relay_saved, sizeof g_relay_saved, strchr(mip, ':') ? "http://%s" : "http://%s:8765", mip);
      save_session();
      set_state(ST_CONFIG, "Probando el PC que indicaste…");
      snprintf(g_site, sizeof g_site, "%s", g_relay_saved);
      cfg_ok = fetch_site_config();
      if (cfg_ok) { g_relay = 1; authed = 0; last_try = 0; }
      else set_error("No pude hablar con %s. ¿Está abierta la app de escritorio y el cortafuegos permite el puerto 8765?", g_relay_saved);
      last_try = now;
      continue;
    }

    if (R_FAILED(hrc)) {
      /* sin servicio HTTP no hay nada que hacer */
    } else if (!cfg_ok) {
      if (now - last_try >= 12) {
        last_try = now;
        set_state(ST_CONFIG, "Leyendo la configuración de la web…");
        cfg_ok = fetch_site_config();
        if (!cfg_ok && R_FAILED(g_cfg_rc) && (u32)g_cfg_rc != NO_NETWORK) {
          set_state(ST_CONFIG, "HTTPS falló. Buscando la app de escritorio de Forja en tu WiFi…");
          cfg_ok = try_relay();
          if (!cfg_ok) set_error("No hay HTTPS (código %d) y no encuentro la app de escritorio. Ábrela en tu PC (misma WiFi) o toca «Escribir IP».", (int)-g_cfg_rc);
        }
        if (!cfg_ok && g_state != ST_ERROR) set_error("No se pudo conectar con %s", g_site);
      }
    } else if (!authed) {
      if (now - last_try >= 12) {
        last_try = now;
        set_state(ST_AUTH, "Iniciando sesión…");
        authed = login();
        if (!authed && !g_relay && R_FAILED(g_net_rc) && (u32)g_net_rc != NO_NETWORK) {
          set_state(ST_AUTH, "HTTPS falló. Buscando la app de escritorio de Forja en tu WiFi…");
          if (try_relay()) { set_state(ST_AUTH, "Puente local encontrado. Iniciando sesión…"); authed = login(); }
          else set_error("No hay HTTPS (código %d) y no encuentro la app de escritorio. Ábrela en tu PC (misma WiFi) o toca «Escribir IP».", (int)-g_net_rc);
        }
        if (authed && g_device[0]) { set_state(ST_RUN, "Conectada"); heartbeat(); last_beat = now; }
        else if (authed) { set_state(ST_PAIR, "Pidiendo código…"); last_poll = 0; }
        else if (g_state != ST_ERROR) set_error("No se pudo iniciar sesión");
      }
    } else if (!g_device[0]) {
      if (now - last_poll >= 3) {
        last_poll = now;
        if (pair_poll()) {
          if (g_device[0]) { set_state(ST_RUN, "Conectada"); heartbeat(); last_beat = now; }
          else set_state(ST_PAIR, "Esperando el código en la web");
        } else if (g_last_status == 401) { authed = 0; last_try = 0; }
        else set_error("Sin respuesta del servidor");
      }
    } else {
      if (!upd_done) { upd_done = 1; maybe_update(); }
      if (now - last_beat >= 15) { last_beat = now; heartbeat(); }
      if (now - last_poll >= 2) {
        last_poll = now;
        char body[160];
        snprintf(body, sizeof body, "{\"p_device\":\"%s\"}", g_device);
        Resp r;
        if (rpc("device_command_claim", body, &r)) {
          fails = 0;
          if (g_state != ST_RUN) set_state(ST_RUN, "Conectada");
          const char *j = (const char *)r.data;
          while (*j == ' ' || *j == '\n') j++;
          if (*j == '{') { handle(j, dummy, sizeof dummy); last_poll = 0; }
          resp_free(&r);
        } else if (strstr(g_last_err, "sin permiso")) {
          /* Desvinculada desde la web: vuelve a pedir un código */
          g_device[0] = 0; save_session();
          set_state(ST_PAIR, "Desvinculada. Pidiendo código…");
        } else {
          set_error("Sin respuesta del servidor");
          last_poll = time(NULL) + 8;   /* espera ~10 s antes de volver a intentarlo */
          if (g_relay && ++fails >= 4) {   /* el PC cambió de IP o se cerró: volver a buscar */
            fails = 0; cfg_ok = 0; authed = 0; g_relay = 0;
            snprintf(g_url, sizeof g_url, "%s", DEFAULT_URL); snprintf(g_anon, sizeof g_anon, "%s", DEFAULT_ANON);
            cfg_ok = g_url[0] && g_anon[0];
            snprintf(g_site, sizeof g_site, "%s", DEFAULT_SITE);
          }
        }
      }
    }
    svcSleepThread(100 * 1000 * 1000LL);   /* 100 ms */
  }
  if (g_curl) curl_easy_cleanup(g_curl);
  curl_global_cleanup();
  if (g_soc_buf) socExit();
}

int main(int argc, char **argv) {
  if (argc > 0 && argv && argv[0]) snprintf(g_self, sizeof g_self, "%s%s", strncmp(argv[0], "sdmc:", 5) ? "sdmc:" : "", argv[0]);
  gfxInitDefault();
  C3D_Init(C3D_DEFAULT_CMDBUF_SIZE);
  C2D_Init(C2D_DEFAULT_MAX_OBJECTS);
  C2D_Prepare();
  C3D_RenderTarget *top = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);
  C3D_RenderTarget *bot = C2D_CreateScreenTarget(GFX_BOTTOM, GFX_LEFT);
  g_tbuf = C2D_TextBufNew(8192);
  LightLock_Init(&g_lock);
  osSetSpeedupEnable(true);
  aptSetSleepAllowed(false);
  psInit();   /* aleatoriedad para mbedTLS */

  s32 prio = 0;
  svcGetThreadPriority(&prio, CUR_THREAD_HANDLE);
  Thread th = threadCreate(worker, NULL, 256 * 1024, prio - 1, -2, false);

  unsigned tick = 0;
  while (aptMainLoop()) {
    hidScanInput();
    if (hidKeysDown() & KEY_START) break;
    u32 kd = hidKeysDown();
    touchPosition tp;
    hidTouchRead(&tp);
    LightLock_Lock(&g_lock); State cur = g_state; LightLock_Unlock(&g_lock);
    if (g_ip_open) {
      if (kd & KEY_B) g_ip_open = 0;
      else if (kd & KEY_TOUCH) ip_tap(tp.px, tp.py);
    } else if (cur == ST_ERROR && ((kd & KEY_A) || ((kd & KEY_TOUCH) && tp.px >= 12 && tp.px < 308 && tp.py >= 188 && tp.py < 224))) {
      ip_open();
    }

    /* Copia del estado para dibujar sin retener el bloqueo */
    LightLock_Lock(&g_lock);
    State st = g_state;
    char status[200], code[16], plabel[48];
    Act acts[5];
    snprintf(status, sizeof status, "%s", g_status);
    snprintf(code, sizeof code, "%s", g_code);
    snprintf(plabel, sizeof plabel, "%s", g_prog_label);
    memcpy(acts, g_acts, sizeof acts);
    int nacts = g_nacts, done = g_done, pl = g_prog_total > 0, pcur = g_prog_cur, ptotal = g_prog_total, pup = g_prog_up;
    u32 diag[2] = {g_diag[0], g_diag[1]};
    LightLock_Unlock(&g_lock);

    C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
    C2D_TextBufClear(g_tbuf);
    C2D_TargetClear(top, C_BG1);
    C2D_SceneBegin(top);
    if (g_ip_open) draw_top(tick, ST_CONFIG, "Escribe la IP de tu PC con la pantalla táctil (la ves en Forja de escritorio → Este equipo).", code, done, pl, pcur, ptotal, plabel, pup);
    else draw_top(tick, st, status, code, done, pl, pcur, ptotal, plabel, pup);
    C2D_TargetClear(bot, C_BG1);
    C2D_SceneBegin(bot);
    if (g_ip_open) draw_keypad(tick);
    else draw_bottom(st, nacts, acts, pl, pcur, ptotal, plabel, diag);
    C3D_FrameEnd(0);
    tick++;
  }

  g_quit = 1;
  threadJoin(th, 4ULL * 1000 * 1000 * 1000);   /* hasta 4 s; si hay una petición en curso, salimos igualmente */
  C2D_TextBufDelete(g_tbuf);
  C2D_Fini();
  C3D_Fini();
  psExit();
  gfxExit();
  return 0;
}
