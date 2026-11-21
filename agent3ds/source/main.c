/*
 * Forja3DS — agente homebrew para Nintendo 3DS.
 *
 * Se conecta a internet (WiFi) y habla con tu proyecto de Supabase usando una cuenta de Forja:
 *   · inicia sesión con email/contraseña (GoTrue),
 *   · avisa de que está vivo (RPC device_heartbeat),
 *   · reclama órdenes (RPC device_command_claim) y devuelve resultados (device_command_finish),
 *   · mueve archivos por trozos de 1 MB a través de Supabase Storage (bucket "transfers").
 * Así la web puede ver y gestionar la tarjeta SD sin PC ni "bridge", desde cualquier red.
 *
 * Sin configuración: lee la URL/clave públicas de la web (/forja-config.json), entra con una cuenta
 * anónima y se empareja con un CÓDIGO que se introduce en la web (como las apps de TV).
 * Opcional: sdmc:/3ds/forja/config.txt (site=, url=, anon=; o email/password/device para el modo clásico).
 * La sesión se guarda en sdmc:/3ds/forja/session.txt.
 */
#include <3ds.h>
#include <stdarg.h>
#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define VERSION "0.1.0"
#define CONFIG_PATH "sdmc:/3ds/forja/config.txt"
#define SESSION_PATH "sdmc:/3ds/forja/session.txt"
#ifndef DEFAULT_SITE
#define DEFAULT_SITE "https://forja-hub.netlify.app"
#endif
#define PART_SIZE (1024 * 1024)
#define MAX_FILE (50u * 1024u * 1024u)
#define MAX_ENTRIES 2000

static char g_url[256], g_anon[512], g_email[160], g_pass[160], g_device[64];
static char g_site[200], g_refresh[1024], g_code[16];
static char g_token[4096];
static u32 g_last_status;
static char g_last_err[120];
static time_t g_token_at = 0;
static char g_status[160] = "Iniciando…";

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */
static PrintConsole g_top, g_bottom;

static void ui_redraw(const char *last) {
  consoleSelect(&g_top);
  printf("\x1b[2J\x1b[1;1H");
  printf("\x1b[33m Forja3DS " VERSION "\x1b[0m\n");
  printf(" ------------------------------------\n");
  printf(" Estado: %s\n\n", g_status);
  if (g_code[0] && !g_device[0]) {
    printf("\x1b[36m  CODIGO DE VINCULACION\x1b[0m\n\n");
    printf("\x1b[1;33m      %s\x1b[0m\n\n", g_code);
    printf(" En Forja (web): 3DS > Anadir\n y escribe este codigo.\n");
  } else {
    printf(" Servidor: %.38s\n", g_url[0] ? g_url : g_site);
    printf(" Dispositivo: %.8s...\n\n", g_device[0] ? g_device : "(sin vincular)");
    printf(" Ultima orden:\n  %.40s\n", last && *last ? last : "-");
  }
  printf("\n\n START = salir\n");
  gfxFlushBuffers();
}

static void set_status(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void set_status(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(g_status, sizeof g_status, fmt, ap);
  va_end(ap);
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
/* HTTP (httpc)                                                        */
/* ------------------------------------------------------------------ */
typedef struct { u8 *data; size_t len; u32 status; } Resp;

static void resp_free(Resp *r) { free(r->data); r->data = NULL; r->len = 0; }

/* hdrs: pares nombre,valor terminados en NULL */
static Result http_do(HTTPC_RequestMethod method, const char *url, const char *const *hdrs,
                      const void *body, u32 body_len, Resp *out) {
  memset(out, 0, sizeof *out);
  httpcContext ctx;
  Result rc = httpcOpenContext(&ctx, method, url, 1);
  if (R_FAILED(rc)) return rc;
  httpcSetSSLOpt(&ctx, SSLCOPT_DisableVerify);   /* la 3DS no trae las CA modernas */
  httpcSetKeepAlive(&ctx, HTTPC_KEEPALIVE_ENABLED);
  httpcAddRequestHeaderField(&ctx, "User-Agent", "Forja3DS/" VERSION);
  for (int i = 0; hdrs && hdrs[i]; i += 2) httpcAddRequestHeaderField(&ctx, hdrs[i], hdrs[i + 1]);
  if (body && body_len) {
    rc = httpcAddPostDataRaw(&ctx, (const u32 *)body, body_len);
    if (R_FAILED(rc)) { httpcCloseContext(&ctx); return rc; }
  }
  rc = httpcBeginRequest(&ctx);
  if (R_FAILED(rc)) { httpcCloseContext(&ctx); return rc; }
  rc = httpcGetResponseStatusCode(&ctx, &out->status);
  if (R_FAILED(rc)) { httpcCloseContext(&ctx); return rc; }

  const u32 step = 0x10000;
  out->data = malloc(step + 1);
  if (!out->data) { httpcCloseContext(&ctx); return -1; }
  u32 got = 0;
  do {
    rc = httpcDownloadData(&ctx, out->data + out->len, step, &got);
    out->len += got;
    if (rc == (Result)HTTPC_RESULTCODE_DOWNLOADPENDING) {
      u8 *np = realloc(out->data, out->len + step + 1);
      if (!np) { httpcCloseContext(&ctx); resp_free(out); return -1; }
      out->data = np;
    }
  } while (rc == (Result)HTTPC_RESULTCODE_DOWNLOADPENDING);
  out->data[out->len] = 0;
  httpcCloseContext(&ctx);
  return R_FAILED(rc) ? rc : 0;
}

/* ---- sesión ---- */
static void save_session(void) {
  mkdir("sdmc:/3ds", 0777);
  mkdir("sdmc:/3ds/forja", 0777);
  FILE *f = fopen(SESSION_PATH, "w");
  if (!f) return;
  fprintf(f, "refresh=%s\ndevice=%s\n", g_refresh, g_device);
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
  }
  fclose(f);
}

/* POST a /auth/v1/...; si va bien guarda los tokens y devuelve 1 */
static int auth_call(const char *path, const char *body) {
  char url[400];
  snprintf(url, sizeof url, "%s%s", g_url, path);
  const char *hdrs[] = {"apikey", g_anon, "Content-Type", "application/json", NULL};
  Resp r;
  Result rc = http_do(HTTPC_METHOD_POST, url, hdrs, body, (u32)strlen(body), &r);
  g_last_status = 0;
  if (R_FAILED(rc)) { set_status("Sin conexion (%08lX)", (unsigned long)rc); return 0; }
  g_last_status = r.status;
  if (r.status != 200) {
    char msg[100] = "";
    json_get_str((char *)r.data, "msg", msg, sizeof msg);
    if (!msg[0]) json_get_str((char *)r.data, "error_description", msg, sizeof msg);
    if (strstr(msg, "nonymous")) set_status("Activa 'Allow anonymous sign-ins' en Supabase");
    else set_status("Login %lu: %.60s", (unsigned long)r.status, msg);
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
  if (!ok) { set_status("Respuesta de login no valida"); return 0; }
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
static Result api(HTTPC_RequestMethod m, const char *path, const char *ctype, const void *body, u32 blen, Resp *out) {
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
  Result rc = api(HTTPC_METHOD_POST, path, "application/json", json_body, (u32)strlen(json_body), out);
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
    set_status("Subiendo %.20s %d/%d", base_name(p), i + 1, parts);
    ui_redraw(NULL);
    Resp r;
    Result rc = api(HTTPC_METHOD_POST, path, "application/octet-stream", chunk, (u32)n, &r);
    if (R_FAILED(rc) || r.status >= 300) { snprintf(err, errcap, "Fallo al subir (HTTP %lu)", R_FAILED(rc) ? 0UL : (unsigned long)r.status); ok = 0; }
    if (!R_FAILED(rc)) resp_free(&r);
  }
  free(chunk); fclose(f);
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
    set_status("Guardando %.20s %d/%d", base_name(p), i + 1, parts);
    ui_redraw(NULL);
    Resp r;
    Result rc = api(HTTPC_METHOD_GET, path, NULL, NULL, 0, &r);
    if (R_FAILED(rc) || r.status != 200) { snprintf(err, errcap, "Fallo al descargar (HTTP %lu)", R_FAILED(rc) ? 0UL : (unsigned long)r.status); ok = 0; }
    if (!R_FAILED(rc)) {
      if (ok && fwrite(r.data, 1, r.len, f) != r.len) { snprintf(err, errcap, "Error al escribir en la SD (llena?)"); ok = 0; }
      resp_free(&r);
    }
  }
  fclose(f);
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
  snprintf(last, lastcap, "%s %s", type, path);

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
  set_status("Conectado");
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
  Result rc = http_do(HTTPC_METHOD_GET, url, NULL, NULL, 0, &r);
  if (R_FAILED(rc)) { set_status("Sin conexion (%08lX)", (unsigned long)rc); return 0; }
  int ok = r.status == 200 && json_get_str((char *)r.data, "url", g_url, sizeof g_url) &&
           json_get_str((char *)r.data, "anon", g_anon, sizeof g_anon);
  if (!ok) set_status("No pude leer la config de la web (HTTP %lu)", (unsigned long)r.status);
  resp_free(&r);
  return ok;
}

/* ------------------------------------------------------------------ */
/* Principal                                                           */
/* ------------------------------------------------------------------ */
static void heartbeat(void) {
  Buf b = {0};
  buf_str(&b, "{\"p_device\":"); buf_json_str(&b, g_device);
  buf_str(&b, ",\"p_info\":{\"proto\":2,\"Agente\":\"Forja3DS " VERSION "\",\"Consola\":\"Nintendo 3DS\"}}");
  Resp r;
  if (rpc("device_heartbeat", b.p, &r)) { resp_free(&r); set_status("Conectado"); }
  free(b.p);
}

/* Pide (o recupera) el código de vinculación; devuelve 1 si el servidor respondió */
static int pair_poll(void) {
  Resp r;
  if (!rpc("device_pair_poll", "{}", &r)) return 0;
  char dev[64] = "";
  json_get_str((char *)r.data, "device_id", dev, sizeof dev);
  if (dev[0]) {
    snprintf(g_device, sizeof g_device, "%s", dev);
    g_code[0] = 0;
    save_session();
  } else {
    json_get_str((char *)r.data, "code", g_code, sizeof g_code);
  }
  resp_free(&r);
  return 1;
}

int main(void) {
  gfxInitDefault();
  consoleInit(GFX_TOP, &g_top);
  consoleInit(GFX_BOTTOM, &g_bottom);
  consoleSelect(&g_bottom);
  printf("\n Forja3DS " VERSION "\n Conecta tu 3DS con Forja.\n\n Deja la app abierta y con WiFi.\n Si cierras la tapa, la consola\n se suspende.\n");
  osSetSpeedupEnable(true);
  aptSetSleepAllowed(false);

  snprintf(g_site, sizeof g_site, "%s", DEFAULT_SITE);
  load_session();
  load_config();
  Result hrc = httpcInit(0);
  if (R_FAILED(hrc)) set_status("httpc no disponible (%08lX)", (unsigned long)hrc);

  char last[160] = "";
  int cfg_ok = g_url[0] && g_anon[0], authed = 0, need_redraw = 1;
  time_t last_beat = 0, last_try = 0, last_poll = 0;
  if (R_SUCCEEDED(hrc)) set_status("Iniciando…");

  while (aptMainLoop()) {
    hidScanInput();
    if (hidKeysDown() & KEY_START) break;
    time_t now = time(NULL);

    if (R_FAILED(hrc)) {
      /* sin servicio HTTP no hay nada que hacer */
    } else if (!cfg_ok) {
      if (now - last_try >= 15) {
        last_try = now;
        set_status("Leyendo configuracion…"); ui_redraw(last);
        cfg_ok = fetch_site_config();
        need_redraw = 1;
      }
    } else if (!authed) {
      if (now - last_try >= 15) {
        last_try = now;
        set_status("Iniciando sesion…"); ui_redraw(last);
        authed = login();
        if (authed && g_device[0]) { set_status("Conectado"); heartbeat(); last_beat = now; }
        else if (authed) set_status("Pidiendo codigo…");
        need_redraw = 1;
      }
    } else if (!g_device[0]) {
      /* Emparejado: muestra el código y espera a que lo apruebes en la web */
      if (now - last_poll >= 3) {
        last_poll = now;
        if (pair_poll()) {
          if (g_device[0]) { set_status("Vinculada. Conectando…"); heartbeat(); last_beat = now; }
          else set_status("Esperando el codigo en la web");
        } else if (g_last_status == 401) { authed = 0; last_try = 0; }
        else set_status("Sin respuesta, reintentando…");
        need_redraw = 1;
      }
    } else {
      if (now - last_beat >= 15) { last_beat = now; heartbeat(); need_redraw = 1; }
      if (now - last_poll >= 2) {
        last_poll = now;
        char body[160];
        snprintf(body, sizeof body, "{\"p_device\":\"%s\"}", g_device);
        Resp r;
        if (rpc("device_command_claim", body, &r)) {
          const char *j = (const char *)r.data;
          while (*j == ' ' || *j == '\n') j++;
          if (*j == '{') { ui_redraw(last); handle(j, last, sizeof last); need_redraw = 1; last_poll = 0; }
          resp_free(&r);
        } else if (strstr(g_last_err, "sin permiso")) {
          /* Desvinculada desde la web: vuelve a pedir un código */
          g_device[0] = 0; save_session();
          set_status("Desvinculada. Pidiendo codigo…");
          need_redraw = 1;
        } else {
          set_status("Sin respuesta, reintentando…");
          last_poll = time(NULL) + 8;   /* espera ~10 s antes de volver a intentarlo */
          need_redraw = 1;
        }
      }
    }
    if (need_redraw) { ui_redraw(last); need_redraw = 0; }
    gspWaitForVBlank();
  }

  httpcExit();
  gfxExit();
  return 0;
}
