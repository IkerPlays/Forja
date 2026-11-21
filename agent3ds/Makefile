# Forja3DS — compila con devkitARM + libctru (devkitPro)
ifeq ($(strip $(DEVKITPRO)),)
$(error "Define DEVKITPRO (p. ej. /opt/devkitpro)")
endif
DEVKITARM ?= $(DEVKITPRO)/devkitARM
CTRULIB   ?= $(DEVKITPRO)/libctru

TARGET := Forja3DS
CC     := $(DEVKITARM)/bin/arm-none-eabi-gcc
ARCH   := -march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft
CFLAGS := -g -Wall -O2 -mword-relocations -fomit-frame-pointer -ffunction-sections $(ARCH) \
          -I$(CTRULIB)/include -D__3DS__ -std=gnu11
LDFLAGS := -specs=3dsx.specs -g $(ARCH) -Wl,-Map,$(TARGET).map -L$(CTRULIB)/lib
LIBS   := -lctru -lm

export PATH := $(DEVKITPRO)/tools/bin:$(DEVKITARM)/bin:$(PATH)

all: $(TARGET).3dsx

# .cia (instalable con FBI): requiere makerom y bannertool en el PATH
cia: $(TARGET).cia

$(TARGET).elf: source/main.c
	$(CC) $(CFLAGS) $< $(LDFLAGS) $(LIBS) -o $@

$(TARGET).smdh: icon.png
	smdhtool --create "Forja3DS" "Conecta tu 3DS con Forja (archivos desde internet)" "Forja" icon.png $@

$(TARGET).3dsx: $(TARGET).elf $(TARGET).smdh
	3dsxtool $(TARGET).elf $@ --smdh=$(TARGET).smdh

banner.bnr: cia/banner.png cia/audio.wav
	bannertool makebanner -i cia/banner.png -a cia/audio.wav -o $@

$(TARGET).cia: $(TARGET).elf $(TARGET).smdh banner.bnr cia/app.rsf
	makerom -f cia -o $@ -elf $(TARGET).elf -rsf cia/app.rsf -icon $(TARGET).smdh -banner banner.bnr -exefslogo -target t

clean:
	rm -f $(TARGET).elf $(TARGET).3dsx $(TARGET).smdh $(TARGET).cia $(TARGET).map banner.bnr

.PHONY: all cia clean
