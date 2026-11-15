import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import { useState } from "react";
import { ConsolePage } from "../shell/ConsolePage";
import { useNotifications } from "../shell/notifications";
import { LAST_USED, usePreferences, type ContentDensity, type UnifiedSettings, type VisualMode } from "../shell/preferences";
import { REGIONS_BY_LOCATION } from "../shell/regions";
import { href } from "../shell/router";

const MODES: { value: VisualMode; label: string; description: string }[] = [
  { value: "system", label: "Browser default", description: "Follow the Windows light or dark setting." },
  { value: "light", label: "Light", description: "Light backgrounds." },
  { value: "dark", label: "Dark", description: "Dark backgrounds." },
];

const DENSITIES: { value: ContentDensity; label: string; description: string }[] = [
  { value: "comfortable", label: "Comfortable", description: "More space between elements." },
  { value: "compact", label: "Compact", description: "Fits more content on the screen." },
];

const REGION_OPTIONS = [
  { label: "Last used Region", value: LAST_USED },
  ...Object.entries(REGIONS_BY_LOCATION).map(([location, regions]) => ({
    label: location,
    options: regions.map((r) => ({ label: r.name, value: r.code, description: r.code })),
  })),
];

function findRegionOption(value: string) {
  for (const o of REGION_OPTIONS) {
    if ("options" in o) {
      const hit = o.options?.find((r) => r.value === value);
      if (hit) return hit;
    } else if (o.value === value) return o;
  }
  return null;
}

/** The console's unified settings: visual mode, density and default Region. */
export function SettingsPage() {
  const { settings, saveSettings } = usePreferences();
  const { notify } = useNotifications();
  const [draft, setDraft] = useState<UnifiedSettings>(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <ConsolePage
      breadcrumbs={[
        { text: "Console Home", href: href("/") },
        { text: "Unified Settings", href: href("/settings") },
      ]}
      help={{
        header: "Unified Settings",
        body: <Box variant="p">These settings apply to every page of this app and are kept on this machine.</Box>,
      }}
      contentType="form"
      content={
        <form onSubmit={(e) => e.preventDefault()}>
          <Form
            header={<Header variant="h1">Unified Settings</Header>}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" disabled={!dirty} onClick={() => setDraft(settings)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={!dirty}
                  onClick={() => {
                    saveSettings(draft);
                    notify({ id: "settings-saved", type: "success", content: "Settings saved." });
                  }}
                >
                  Save changes
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Display</Header>}>
                <SpaceBetween size="l">
                  <FormField label="Visual mode">
                    <Tiles
                      value={draft.visualMode}
                      onChange={({ detail }) => setDraft({ ...draft, visualMode: detail.value as VisualMode })}
                      items={MODES}
                    />
                  </FormField>
                  <FormField label="Density">
                    <Tiles
                      value={draft.density}
                      onChange={({ detail }) => setDraft({ ...draft, density: detail.value as ContentDensity })}
                      items={DENSITIES}
                    />
                  </FormField>
                </SpaceBetween>
              </Container>
              <Container header={<Header variant="h2">Localization and default Region</Header>}>
                <FormField
                  label="Default Region"
                  description="The Region the app opens in. The emulator keeps a separate set of resources per Region."
                >
                  <Select
                    selectedOption={findRegionOption(draft.defaultRegion)}
                    options={REGION_OPTIONS}
                    onChange={({ detail }) => setDraft({ ...draft, defaultRegion: detail.selectedOption.value ?? LAST_USED })}
                  />
                </FormField>
              </Container>
            </SpaceBetween>
          </Form>
        </form>
      }
    />
  );
}
