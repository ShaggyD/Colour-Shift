UUID      := colorshift@dchadwick.local
EXT_DIR   ?= $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SCHEMA_ID := org.gnome.shell.extensions.colorshift
SCHEMA    := schemas/$(SCHEMA_ID).gschema.xml

.PHONY: all schemas install uninstall enable disable pack clean

all: schemas

# Compile the GSettings schema (required for `Extension.getSettings()`).
schemas: $(SCHEMA)
	glib-compile-schemas schemas

# Copy the extension into the user extensions directory and build its schema.
install: schemas
	mkdir -p "$(EXT_DIR)/schemas"
	install -m644 extension.js metadata.json README.md "$(EXT_DIR)/"
	install -m644 $(SCHEMA) "$(EXT_DIR)/schemas/"
	glib-compile-schemas "$(EXT_DIR)/schemas"

uninstall:
	rm -rf "$(EXT_DIR)"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

# Build a distributable zip (extensions.gnome.org layout).
pack: schemas
	gnome-extensions pack --force --extra-source=README.md --extra-source=LICENSE

clean:
	rm -f schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
