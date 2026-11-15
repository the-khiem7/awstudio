import type { AppLayoutProps } from "@cloudscape-design/components/app-layout";
import AppLayoutToolbar from "@cloudscape-design/components/app-layout-toolbar";
import BreadcrumbGroup, { type BreadcrumbGroupProps } from "@cloudscape-design/components/breadcrumb-group";
import HelpPanel from "@cloudscape-design/components/help-panel";
import Link, { type LinkProps } from "@cloudscape-design/components/link";
import SideNavigation, { type SideNavigationProps } from "@cloudscape-design/components/side-navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Notifications } from "./notifications";
import { useLocation } from "./router";

export interface HelpContent {
  header: string;
  body: ReactNode;
  footer?: ReactNode;
}

export interface SplitPanelSlot {
  panel: ReactNode;
  open: boolean;
  onToggle: (open: boolean) => void;
  size?: number;
  onResize?: (size: number) => void;
}

export interface ConsolePageProps {
  breadcrumbs: BreadcrumbGroupProps.Item[];
  content: ReactNode;
  /** Help panel shown by the info links of the page; its first entry is the page's own topic. */
  help?: HelpContent;
  contentType?: AppLayoutProps.ContentType;
  /** Service side navigation: header and items, as the console shows for each service. */
  navigation?: { header: SideNavigationProps.Header; items: SideNavigationProps.Item[] };
  splitPanel?: SplitPanelSlot;
}

interface HelpValue {
  /** Opens the help panel, with other content than the page's own topic when given. */
  openHelp: (content?: HelpContent) => void;
}

const HelpContext = createContext<HelpValue>({ openHelp: () => undefined });

export function useHelp(): HelpValue {
  return useContext(HelpContext);
}

/** The console's "Info" link: opens the help panel on a topic. */
export function InfoLink({ topic, ariaLabel }: { topic?: HelpContent; ariaLabel?: string }) {
  const { openHelp } = useHelp();
  const follow: LinkProps["onFollow"] = (e) => {
    e.preventDefault();
    openHelp(topic);
  };
  return (
    <Link variant="info" onFollow={follow} ariaLabel={ariaLabel ?? `Information about ${topic?.header ?? "this page"}`}>
      Info
    </Link>
  );
}

/**
 * One console page: breadcrumbs, the Flashbar, an optional service side navigation, the help
 * panel and the split panel. Each route renders its own, as console pages do.
 */
export function ConsolePage({ breadcrumbs, content, help, contentType, navigation, splitPanel }: ConsolePageProps) {
  const layout = useRef<AppLayoutProps.Ref>(null);
  const { path } = useLocation();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [topic, setTopic] = useState<HelpContent | undefined>(help);
  const [navigationOpen, setNavigationOpen] = useState(true);

  const openHelp = (content?: HelpContent) => {
    setTopic(content ?? help);
    setToolsOpen(true);
    layout.current?.focusToolsClose();
  };

  const shown = topic ?? help;
  return (
    <HelpContext.Provider value={{ openHelp }}>
      <AppLayoutToolbar
        ref={layout}
        headerSelector="#top-nav"
        contentType={contentType}
        breadcrumbs={<BreadcrumbGroup items={breadcrumbs} expandAriaLabel="Show path" ariaLabel="Breadcrumbs"/>}
        notifications={<Notifications />}
        stickyNotifications
        navigationHide={!navigation}
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        navigation={
          navigation && (
            <SideNavigation
              header={navigation.header}
              items={navigation.items}
              activeHref={`#${path}`}
            />
          )
        }
        toolsHide={!shown}
        toolsOpen={toolsOpen}
        onToolsChange={({ detail }) => setToolsOpen(detail.open)}
        tools={shown && <HelpPanel header={<h2>{shown.header}</h2>} footer={shown.footer}>{shown.body}</HelpPanel>}
        splitPanel={splitPanel?.panel}
        splitPanelOpen={splitPanel?.open}
        onSplitPanelToggle={splitPanel ? ({ detail }) => splitPanel.onToggle(detail.open) : undefined}
        splitPanelSize={splitPanel?.size}
        onSplitPanelResize={splitPanel?.onResize ? ({ detail }) => splitPanel.onResize?.(detail.size) : undefined}
        content={content}
      />
    </HelpContext.Provider>
  );
}
