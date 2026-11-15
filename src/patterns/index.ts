// Console page patterns, ported from cloudscape-design/demos (MIT-0) and gated by the capability
// matrix. Service pages compose these instead of building tables, forms and modals themselves.

export { useComparisonSplitPanel, type ComparedProperty, type ComparisonOptions } from "./ComparisonSplitPanel";
export { CreateForm, type CreateFormProps } from "./CreateForm";
export { CreateWizard, type CreateWizardProps, type WizardStep } from "./CreateWizard";
export { DeleteModal, type DeleteModalProps } from "./DeleteModal";
export { DetailsPage, type DetailsPageProps, type DetailsSection } from "./DetailsPage";
export { GatedButton, PartialBanner, ScopeBanner, UiOnlyScope, UnsupportedBanner, useGate, usePageCapability, useUiOnly, type GatedButtonProps } from "./gating";
export { ManageTags, type ManageTagsProps, type Tag } from "./ManageTags";
export { ResourceTable, type ResourceTableColumn, type ResourceTableProps } from "./ResourceTable";
export { S3Picker, type S3PickerProps, type S3Source } from "./S3Picker";
export { ResourceCounts, ServiceDashboard, type DashboardWidget, type ServiceDashboardProps } from "./ServiceDashboard";
export { dateTimeProperty, textProperty } from "./table-common";
export { useUnsavedChanges } from "./unsaved";
