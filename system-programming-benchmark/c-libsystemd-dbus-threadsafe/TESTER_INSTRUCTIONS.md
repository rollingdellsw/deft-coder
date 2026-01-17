### Test base:

```
git clone https://github.com/systemd/systemd.git; cd systemd
git checkout fa8cf1e54dcdc388ec7a4da190c363018814050d
// Apply the thread-safe test case from this benchmark case folder
git am ${BENCHMARK_CASE}/0001-Add-dbus-thread-safe-test-case.patch
```

### Requiremnt:

Need to be able to run
```
~/workspace/systemd$ setarch $(uname -m) -R meson setup builddir -Dc_args='-fsanitize=thread -g -O1' -Dc_link_args='-ltsan'
~/workspace/systemd$ setarch $(uname -m) -R meson compile -C builddir
~/workspace/systemd$ eval `dbus-launch --auto-syntax`
~/workspace/systemd$ setarch $(uname -m) -R ./builddir/test-bus-thread-sanitizer
```

You are expected to see log like this:

```
==================
WARNING: ThreadSanitizer: data race (pid=83223)
  Read of size 4 at 0x7b7000020000 by thread T4:
```
