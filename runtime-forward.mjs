// A 401 rejects the call before execution. Only that response permits one retry.
// Timeouts, connection failures and other statuses may be ambiguous for mutations.
export async function forwardRuntimeCall(runtime, {send, refresh}) {
  let response = await send(runtime);
  if (response.status === 401) {
    const fresh = await refresh();
    if (fresh && (fresh.port !== runtime.port || fresh.token !== runtime.token)) {
      await response.body?.cancel();
      runtime = fresh;
      response = await send(runtime);
    }
  }
  return {runtime, response};
}
