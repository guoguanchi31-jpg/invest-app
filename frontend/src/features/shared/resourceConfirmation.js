// Order reads and writes without depending on the device clock.
let sequence = 0;
export const nextResourceEvent = () => ++sequence;

export function confirmsSubmission(intent, confirmations, identityKey) {
  // A related refresh can finish while executeSubmission is still awaiting it.
  // Remember that evidence now; the caller releases only after pending ends.
  return Boolean(intent.resourceKey)
    && ["committed", "invalidated"].includes(intent.status)
    && confirmations.some((receipt) => receipt
      && receipt.identityKey === identityKey
      && receipt.resourceKey === intent.resourceKey
      && receipt.startedAfter > intent.settledAt);
}
