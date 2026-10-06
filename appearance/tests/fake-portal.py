#!/usr/bin/python3
"""Test-only Settings portal on the isolated bus created by test-native.ts."""
import json
import os
import sys
from gi.repository import Gio, GLib

XML = '''<node><interface name="org.freedesktop.portal.Settings">
<method name="Read"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
<signal name="SettingChanged"><arg type="s"/><arg type="s"/><arg type="v"/></signal>
</interface></node>'''
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
color = 1
owner = 0
fail_read = '--read-fails' in sys.argv
single_variant = '--single-variant' in sys.argv

def note(value):
    print(json.dumps(value), flush=True)

def method(connection, sender, path, interface, name, parameters, invocation):
    if name != 'Read' or parameters.unpack() != ('org.freedesktop.appearance', 'color-scheme'):
        invocation.return_dbus_error('io.jazzkeys.TestFailure', 'Unexpected settings access')
        note({'error': 'Unexpected settings access'})
        return
    if fail_read:
        invocation.return_dbus_error('org.freedesktop.portal.Error.NotFound', 'Test-only missing setting')
        return
    value = GLib.Variant('u', color)
    if not single_variant:
        value = GLib.Variant('v', value)
    invocation.return_value(GLib.Variant('(v)', (value,)))

def own():
    global owner
    owner = Gio.bus_own_name_on_connection(connection, 'org.freedesktop.portal.Desktop', Gio.BusNameOwnerFlags.NONE,
        lambda *args: note({'ready': True}), None)

connection.register_object('/org/freedesktop/portal/desktop', Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], method, None, None)
own()

def handle(command):
    global color, owner
    if command == 'lose':
        Gio.bus_unown_name(owner)
        owner = 0
    elif command == 'regain':
        own()
    elif command == 'quit':
        loop.quit()
        return False
    else:
        if command not in ('dark', 'light', 'none', 'unknown', 'malformed', 'unrelated'):
            raise RuntimeError('Unknown fixture command')
        color = {'dark': 1, 'light': 2, 'none': 0, 'unknown': 99}.get(command, color)
        key = 'unrelated-test-key' if command == 'unrelated' else 'color-scheme'
        value = GLib.Variant('s', 'invalid') if command == 'malformed' else GLib.Variant('u', color)
        connection.emit_signal(None, '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Settings',
            'SettingChanged', GLib.Variant('(ssv)', ('org.freedesktop.appearance', key, value)))
    return True

pending = b''
def command(fd, condition):
    global pending
    data = os.read(fd, 4096)
    if not data:
        loop.quit()
        return False
    pending += data
    while b'\n' in pending:
        line, pending = pending.split(b'\n', 1)
        if not handle(line.decode('ascii')):
            return False
    return True

GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, command)
loop.run()
if owner:
    Gio.bus_unown_name(owner)
