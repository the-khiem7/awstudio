import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { Runtime } from "../runtime/Runtime";
import { ConsolePage, InfoLink } from "../shell/ConsolePage";
import { href } from "../shell/router";

const HELP = {
  header: "Emulator",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">
        The emulator runs on this machine and keeps every resource in memory. Stopping or restarting it deletes all
        resources and gives it new access keys.
      </Box>
      <Box variant="p">
        Pick a runtime provider: Docker builds a container from the AWS package, Native runs a binary inside WSL, and
        Attach connects to an emulator that is already running.
      </Box>
      <Box variant="p">
        The version check compares the running build with the build the capability matrix was made from. When they
        differ, controls still follow the pinned matrix.
      </Box>
    </SpaceBetween>
  ),
};

export function EmulatorPage() {
  return (
    <ConsolePage
      breadcrumbs={[
        { text: "Console Home", href: href("/") },
        { text: "Emulator", href: href("/emulator") },
      ]}
      help={HELP}
      content={
        <SpaceBetween size="m">
          <Header variant="h1" info={<InfoLink />} description="Start, stop and configure the local AWS Emulator, and point the AWS CLI and SDKs at it.">
            Emulator
          </Header>
          <Runtime />
        </SpaceBetween>
      }
    />
  );
}
