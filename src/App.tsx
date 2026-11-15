import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import { I18nProvider } from "@cloudscape-design/components/i18n";
import enMessages from "@cloudscape-design/components/i18n/messages/all.en.json";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { CapabilityProvider } from "./capability";
import { ConsoleHome } from "./pages/ConsoleHome";
import { EmulatorPage } from "./pages/EmulatorPage";
import { ServiceLanding } from "./pages/ServiceLanding";
import { SettingsPage } from "./pages/SettingsPage";
import { RuntimeStatusProvider } from "./runtime/RuntimeStatus";
import { ConsolePage } from "./shell/ConsolePage";
import { TelemetryNotice, VersionNotice } from "./shell/GlobalNotices";
import { NotificationsProvider } from "./shell/notifications";
import { PreferencesProvider } from "./shell/preferences";
import { href, matchPath, useLocation } from "./shell/router";
import { serviceForPath } from "./shell/services";
import { recordVisit } from "./shell/storage";
import { TopNav } from "./shell/TopNav";

// Only a development build carries the pattern gallery; `import.meta.env.DEV` is false in a
// release build, so the bundler drops the import.
const PatternGallery = import.meta.env.DEV ? lazy(() => import("./pages/PatternGallery").then((m) => ({ default: m.PatternGallery }))) : null;

function NotFound({ path }: { path: string }) {
  return (
    <ConsolePage
      breadcrumbs={[{ text: "Console Home", href: href("/") }]}
      content={
        <SpaceBetween size="m">
          <Header variant="h1">Page not found</Header>
          <Box variant="p">
            There is no page at <Box variant="code">{path}</Box>. <Link href={href("/")}>Go to Console Home</Link>
          </Box>
        </SpaceBetween>
      }
    />
  );
}

function Routes() {
  const { path } = useLocation();
  const service = serviceForPath(path);

  useEffect(() => {
    if (service) recordVisit(service.id);
  }, [service]);

  let page: ReactNode;
  const gallery = matchPath("/dev/patterns/:pattern", path);
  if (path === "/") page = <ConsoleHome />;
  else if (path === "/emulator") page = <EmulatorPage />;
  else if (path === "/settings") page = <SettingsPage />;
  else if (service) page = <ServiceLanding key={service.id} service={service} />;
  else if (PatternGallery && (gallery || path === "/dev/patterns"))
    page = (
      <Suspense fallback={null}>
        <PatternGallery pattern={gallery?.pattern ?? "gating"} />
      </Suspense>
    );
  else page = <NotFound path={path} />;
  return <>{page}</>;
}

export function App() {
  return (
    <I18nProvider locale="en" messages={[enMessages]}>
      <PreferencesProvider>
        <RuntimeStatusProvider>
          <CapabilityProvider>
            <NotificationsProvider>
              <div id="top-nav" style={{ position: "sticky", top: 0, zIndex: 1002 }}>
                <TopNav />
              </div>
              <Routes />
              <TelemetryNotice />
              <VersionNotice />
            </NotificationsProvider>
          </CapabilityProvider>
        </RuntimeStatusProvider>
      </PreferencesProvider>
    </I18nProvider>
  );
}
