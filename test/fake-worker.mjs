/**
 * A stand-in for the rendering worker, driven by the same two-step protocol
 * the real one speaks: it answers "open" with a page count and "render" with
 * one message per page. The orchestration around it — waiting for every
 * worker to open before any of them is told a width, dealing out the pages,
 * counting the finishes — had no coverage at all, and a dropped line in the
 * real worker is what broke the sheet twice.
 */
export function fakeWorkerFactory({ pageCount = 8, failOn = null,
                                    errorOn = null, silentOn = null,
                                    outline = null } = {}) {
  const made = [];
  function FakeWorker(url, options) {
    const self = this;
    this.url = url;
    this.options = options;
    this.index = made.length;
    this.posted = [];
    this.terminated = false;
    this.listeners = { message: [], error: [] };
    made.push(this);

    this.addEventListener = (type, fn) => self.listeners[type].push(fn);
    this.terminate = () => { self.terminated = true; };
    this.postMessage = (message) => {
      self.posted.push(message);
      queueMicrotask(() => self._handle(message));
    };
    this._emit = (type, data) => {
      for (const fn of self.listeners[type]) fn(type === 'message' ? { data } : data);
    };
    this._handle = (message) => {
      if (self.terminated) return;
      if (message.type === 'open') {
        if (errorOn === self.index) return self._emit('error', { message: 'boom' });
        if (silentOn === self.index) return;
        // The outline travels with the answer of the one worker asked for it,
        // exactly as the real worker does it
        const reply = { type: 'opened', pageCount };
        if (message.outline && outline) reply.outline = outline;
        return self._emit('message', reply);
      }
      if (message.type === 'render') {
        if (failOn === self.index) {
          return self._emit('message', { type: 'failed', error: 'no' });
        }
        for (const page of message.pages) {
          self._emit('message', {
            type: 'page', page,
            height: Math.round(message.width * 1.33),
            buffer: new ArrayBuffer(8),
            // the text a real worker reads off the page; page 2 carries
            // the one sequence that could close the block it is stored in
            text: page === 2 ? 'Page two says </script> and goes on' : 'Text of page ' + page,
          });
        }
        self._emit('message', { type: 'done' });
      }
    };
  }
  return { FakeWorker, made };
}
