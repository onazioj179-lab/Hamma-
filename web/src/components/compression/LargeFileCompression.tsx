/** Server job prototype: no durable compression pipeline is available yet. */
export function LargeFileCompression() {
  return (
    <section className="ios-card p-8" aria-labelledby="large-file-title">
      <h2 id="large-file-title" className="text-2xl font-semibold mb-4">Large-file server jobs</h2>
      <p role="status" className="text-muted">
        Server streaming is not available yet. Use the Compress tab for local compression and restoration.
      </p>
    </section>
  );
}
