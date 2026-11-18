# Runs a command in a pseudo-terminal of a given size, for tests: what the
# terminal shows comes out on stdout as JSON lines {"t": ms, "b64": bytes};
# each line on stdin is either a JSON string, typed into the terminal (so a
# test can press Ctrl+C or an arrow), or {"resize": [cols, rows]}, which
# resizes it and sends SIGWINCH. Only Python's standard library.
#   python3 pty-driver.py <cols> <rows> <command> [args...]
import base64, fcntl, json, os, pty, select, struct, sys, termios, time

cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, master = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
os.kill(pid, 28)  # SIGWINCH: the size is set after the fork
out = sys.stdout
stdin_open = True
while True:
    fds = [master] + ([sys.stdin] if stdin_open else [])
    ready, _, _ = select.select(fds, [], [], 0.05)
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        out.write(json.dumps({"t": int(time.time() * 1000), "b64": base64.b64encode(data).decode()}) + "\n")
        out.flush()
    if sys.stdin in ready:
        line = sys.stdin.readline()
        if not line:
            stdin_open = False
        elif line.strip():
            message = json.loads(line)
            if isinstance(message, dict) and "resize" in message:
                c, r = message["resize"]
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
                os.kill(pid, 28)
            else:
                os.write(master, message.encode())
_, status = os.waitpid(pid, 0)
code = os.waitstatus_to_exitcode(status)
sys.exit(code if code >= 0 else 128 - code)
