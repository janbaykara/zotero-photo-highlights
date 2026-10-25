/**
 * Thin wrapper around Zotero.Notifier.registerObserver / unregisterObserver.
 */

type NotifyFn = (
  event: string,
  type: string,
  ids: (number | string)[],
  extraData: { [key: string]: any },
) => void | Promise<void>;

export function subscribeNotifier(
  types: _ZoteroTypes.Notifier.Type[],
  notify: NotifyFn,
): () => void {
  const observer = { notify };
  const notifierID = Zotero.Notifier.registerObserver(observer, types);
  return () => {
    Zotero.Notifier.unregisterObserver(notifierID);
  };
}
