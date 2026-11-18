import Autosuggest, { type AutosuggestProps } from "@cloudscape-design/components/autosuggest";
import type { ButtonDropdownProps } from "@cloudscape-design/components/button-dropdown";
import TopNavigation, { type TopNavigationProps } from "@cloudscape-design/components/top-navigation";
import { useEffect, useRef, useState } from "react";
import { useRuntimeStatus } from "../runtime/RuntimeStatus";
import { usePreferences } from "./preferences";
import { REGIONS_BY_LOCATION, regionName } from "./regions";
import { href, navigate } from "./router";
import { CATEGORIES, SERVICES, searchServices } from "./services";

/** The emulator has one account. */
export const ACCOUNT_ID = "000000000000";

// The permanent LOCAL badge: drawn as the identity logo, so it sits beside the product name on
// every page and cannot be dismissed or collapsed into the overflow menu.
const LOCAL_BADGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="22" viewBox="0 0 58 22"><rect x="0.5" y="0.5" width="57" height="21" rx="4" fill="#ff9900" stroke="#ffb84d"/><text x="29" y="15.5" text-anchor="middle" font-family="Open Sans, Helvetica Neue, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="1" fill="#0f141a">LOCAL</text></svg>`,
  );

function formatAccount(id: string) {
  return id.replace(/(\d{4})(\d{4})(\d{4})/, "$1-$2-$3");
}

function ServiceSearch() {
  const [value, setValue] = useState("");
  const ref = useRef<AutosuggestProps.Ref>(null);

  // The console focuses its search box on Alt+S.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const options = searchServices(value).map((s) => ({
    value: s.id,
    label: s.title,
    description: s.description,
    tags: [s.category],
  }));

  return (
    <Autosuggest
      ref={ref}
      value={value}
      onChange={({ detail }) => setValue(detail.value)}
      onSelect={({ detail }) => {
        const service = SERVICES.find((s) => s.id === detail.value);
        setValue("");
        if (service) navigate(href(service.path));
      }}
      options={options}
      filteringType="manual"
      placeholder="Search [Alt+S]"
      ariaLabel="Search services"
      enteredTextLabel={(v) => `Search for "${v}"`}
      empty="No matching services"
      virtualScroll={false}
      expandToViewport
    />
  );
}

export function TopNav() {
  const { region, setRegion } = usePreferences();
  const { status, running, healthy } = useRuntimeStatus();

  const servicesMenu: ButtonDropdownProps.ItemOrGroup[] = [
    { id: "home", text: "Console Home", href: href("/") },
    {
      text: "Emulator tools",
      items: [
        { id: "api-console", text: "API Console", secondaryText: "Run any operation of any modeled service", href: href("/api-console") },
        { id: "fidelity", text: "Fidelity catalog", secondaryText: "Support level of every modeled service", href: href("/fidelity") },
        { id: "seeds", text: "Seed scripts", secondaryText: "Rebuild state after a restart", href: href("/seeds") },
      ],
    },
    ...CATEGORIES.map((category) => ({
      text: category,
      items: SERVICES.filter((s) => s.category === category).map((s) => ({
        id: s.id,
        text: s.title,
        secondaryText: s.description,
        href: href(s.path),
      })),
    })),
  ];

  const regionMenu: ButtonDropdownProps.ItemOrGroup[] = Object.entries(REGIONS_BY_LOCATION).map(([location, regions]) => ({
    text: location,
    items: regions.map((r) => ({
      id: r.code,
      text: r.name,
      secondaryText: r.code,
      iconName: r.code === region ? ("check" as const) : undefined,
    })),
  }));

  const emulatorText = !status
    ? "Emulator"
    : status.busy
      ? "Emulator: working"
      : healthy
        ? "Emulator: running"
        : running
          ? "Emulator: starting"
          : "Emulator: stopped";

  const utilities: TopNavigationProps.Utility[] = [
    {
      type: "menu-dropdown",
      text: "Services",
      description: "Services with console pages",
      items: servicesMenu,
    },
    {
      type: "button",
      text: emulatorText,
      iconName: healthy ? "status-positive" : running ? "status-pending" : "status-stopped",
      href: href("/emulator"),
    },
    {
      type: "menu-dropdown",
      text: regionName(region),
      description: `Region: ${region}`,
      ariaLabel: `Region ${regionName(region)}, ${region}`,
      items: regionMenu,
      onItemClick: ({ detail }) => setRegion(detail.id),
    },
    {
      type: "button",
      iconName: "settings",
      ariaLabel: "Settings",
      title: "Settings",
      href: href("/settings"),
    },
    {
      type: "menu-dropdown",
      text: "local",
      description: `Account ID: ${formatAccount(ACCOUNT_ID)}`,
      iconName: "user-profile",
      items: [
        { id: "account", text: `Account ID: ${formatAccount(ACCOUNT_ID)}`, disabled: true },
        { id: "emulator", text: "Emulator", href: href("/emulator") },
        { id: "settings", text: "Settings", href: href("/settings") },
      ],
    },
  ];

  return (
    <TopNavigation
      identity={{
        href: href("/"),
        title: "AWStudio",
        logo: { src: LOCAL_BADGE, alt: "LOCAL" },
      }}
      search={<ServiceSearch />}
      utilities={utilities}
    />
  );
}
