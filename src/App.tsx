import AppLayout from "@cloudscape-design/components/app-layout";
import Header from "@cloudscape-design/components/header";

export function App() {
  return (
    <AppLayout
      navigationHide
      toolsHide
      content={<Header variant="h1">awsandbox</Header>}
    />
  );
}
