/* First-party read-only observer. No GTK, window, configuration write or command API. */
#include <gio/gio.h>
#include <glib-unix.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define PORTAL "org.freedesktop.portal.Desktop"
#define OBJECT "/org/freedesktop/portal/desktop"
#define SETTINGS "org.freedesktop.portal.Settings"
#define NAMESPACE "org.freedesktop.appearance"
#define KEY "color-scheme"

static GMainLoop *loop;
static GDBusProxy *proxy;
static int last = -1;
static guint generation;
static char last_frame[160];

static void emit(int appearance, gboolean live) {
  char frame[160];
  const char *value = appearance < 0 ? "null" : appearance == 1 ? "\"dark\"" : "\"light\"";
  const char *availability = appearance < 0 ? "unavailable" : live ? "live" : "read-once";
  g_snprintf(frame, sizeof frame, "{\"v\":1,\"appearance\":%s,\"availability\":\"%s\"}\n", value, availability);
  if (strcmp(frame, last_frame) != 0) {
    if (fputs(frame, stdout) == EOF || fflush(stdout) == EOF) _exit(0);
    g_strlcpy(last_frame, frame, sizeof last_frame);
  }
}

/* Read uses nested variants on older portals. Unwrap only the specified bounds. */
static int color(GVariant *value) {
  GVariant *inner = g_variant_ref(value);
  for (int depth = 0; depth < 2 && g_variant_is_of_type(inner, G_VARIANT_TYPE_VARIANT); depth++) {
    GVariant *next = g_variant_get_variant(inner);
    g_variant_unref(inner);
    inner = next;
  }
  int result = -1;
  if (g_variant_is_of_type(inner, G_VARIANT_TYPE_UINT32)) result = g_variant_get_uint32(inner) == 1 ? 1 : 0;
  g_variant_unref(inner);
  return result;
}

static void read_finished(GObject *source, GAsyncResult *result, gpointer data) {
  const guint requested_generation = GPOINTER_TO_UINT(data);
  GError *error = NULL;
  GVariant *reply = g_dbus_proxy_call_finish(G_DBUS_PROXY(source), result, &error);
  if (requested_generation == generation) {
    int next = -1;
    if (reply && g_variant_is_of_type(reply, G_VARIANT_TYPE("(v)"))) {
      GVariant *value = g_variant_get_child_value(reply, 0);
      next = color(value);
      g_variant_unref(value);
    }
    if (next >= 0) { last = next; emit(last, TRUE); }
    else emit(last, FALSE);
  }
  if (reply) g_variant_unref(reply);
  g_clear_error(&error);
}

static void read_current(void) {
  generation++;
  char *owner = g_dbus_proxy_get_name_owner(proxy);
  if (!owner) { emit(last, FALSE); return; }
  g_free(owner);
  g_dbus_proxy_call(proxy, "Read", g_variant_new("(ss)", NAMESPACE, KEY),
    G_DBUS_CALL_FLAGS_NO_AUTO_START, 1200, NULL, read_finished, GUINT_TO_POINTER(generation));
}

static void owner_changed(GObject *object, GParamSpec *spec, gpointer data) {
  (void)object; (void)spec; (void)data;
  read_current();
}
static void setting_changed(GDBusProxy *object, const gchar *sender, const gchar *name, GVariant *parameters, gpointer data) {
  (void)object; (void)sender; (void)data;
  if (strcmp(name, "SettingChanged") || !g_variant_is_of_type(parameters, G_VARIANT_TYPE("(ssv)"))) return;
  const char *space, *key;
  GVariant *value;
  g_variant_get(parameters, "(&s&sv)", &space, &key, &value);
  if (!strcmp(space, NAMESPACE) && !strcmp(key, KEY)) {
    generation++; /* A change newer than an in-flight Read wins. */
    int next = color(value);
    if (next >= 0) { last = next; emit(last, TRUE); }
    else emit(last, FALSE);
  }
  g_variant_unref(value);
}
static void bus_closed(GDBusConnection *connection, gboolean remote, GError *error, gpointer data) {
  (void)connection; (void)remote; (void)error; (void)data;
  generation++;
  emit(last, FALSE);
}
static void connected(GObject *source, GAsyncResult *result, gpointer data) {
  (void)source; (void)data;
  GError *error = NULL;
  proxy = g_dbus_proxy_new_for_bus_finish(result, &error);
  if (!proxy) { g_clear_error(&error); emit(-1, FALSE); return; }
  g_signal_connect(proxy, "g-signal", G_CALLBACK(setting_changed), NULL);
  g_signal_connect(proxy, "notify::g-name-owner", G_CALLBACK(owner_changed), NULL);
  GDBusConnection *connection = g_dbus_proxy_get_connection(proxy);
  g_dbus_connection_set_exit_on_close(connection, FALSE);
  g_signal_connect(connection, "closed", G_CALLBACK(bus_closed), NULL);
  read_current();
}
static gboolean parent_closed(gint fd, GIOCondition condition, gpointer data) {
  (void)fd; (void)condition; (void)data;
  /* stdin has no commands. Any byte, EOF, hangup or error terminates the observer. */
  g_main_loop_quit(loop);
  return G_SOURCE_REMOVE;
}
int main(int argc, char **argv) {
  (void)argv;
  if (argc != 1) return 64;
  signal(SIGPIPE, SIG_IGN);
  const char *address = getenv("DBUS_SESSION_BUS_ADDRESS");
  if (!address || strncmp(address, "unix:", 5) || strchr(address, ';')) { emit(-1, FALSE); return 0; }
  loop = g_main_loop_new(NULL, FALSE);
  g_unix_fd_add(STDIN_FILENO, G_IO_IN | G_IO_HUP | G_IO_ERR | G_IO_NVAL, parent_closed, NULL);
  g_dbus_proxy_new_for_bus(G_BUS_TYPE_SESSION, G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES | G_DBUS_PROXY_FLAGS_DO_NOT_AUTO_START,
    NULL, PORTAL, OBJECT, SETTINGS, NULL, connected, NULL);
  g_main_loop_run(loop);
  if (proxy) g_object_unref(proxy);
  g_main_loop_unref(loop);
  return 0;
}
