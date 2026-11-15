import Flashbar, { type FlashbarProps } from "@cloudscape-design/components/flashbar";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface Notice {
  /** Same id replaces the earlier notice, so a repeated event shows once. */
  id?: string;
  type: FlashbarProps.Type;
  header?: ReactNode;
  content?: ReactNode;
  action?: ReactNode;
  /** Defaults to true; a notice that tracks live state passes false and is removed by its owner. */
  dismissible?: boolean;
}

interface NotificationsValue {
  notify: (notice: Notice) => string;
  dismiss: (id: string) => void;
  items: FlashbarProps.MessageDefinition[];
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

let counter = 0;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<(Notice & { id: string })[]>([]);

  const dismiss = useCallback((id: string) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);

  const notify = useCallback((notice: Notice) => {
    const id = notice.id ?? `notice-${++counter}`;
    setNotices((prev) => [...prev.filter((n) => n.id !== id), { ...notice, id }]);
    return id;
  }, []);

  const items = useMemo<FlashbarProps.MessageDefinition[]>(
    () =>
      notices.map((n) => ({
        id: n.id,
        type: n.type,
        header: n.header,
        content: n.content,
        action: n.action,
        dismissible: n.dismissible ?? true,
        dismissLabel: "Dismiss message",
        onDismiss: () => dismiss(n.id),
      })),
    [notices, dismiss],
  );

  const value = useMemo(() => ({ notify, dismiss, items }), [notify, dismiss, items]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications outside NotificationsProvider");
  return value;
}

/** The Flashbar of every page. */
export function Notifications() {
  const { items } = useNotifications();
  return <Flashbar items={items} stackItems={items.length > 2} />;
}
