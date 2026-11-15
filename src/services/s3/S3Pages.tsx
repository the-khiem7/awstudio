// Amazon S3 console pages: general purpose buckets, create bucket, bucket details with the Objects,
// Properties, Permissions and Management tabs, and object details with versions.

import Box from "@cloudscape-design/components/box";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Link from "@cloudscape-design/components/link";
import ProgressBar from "@cloudscape-design/components/progress-bar";
import RadioGroup from "@cloudscape-design/components/radio-group";
import SpaceBetween from "@cloudscape-design/components/space-between";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import Table from "@cloudscape-design/components/table";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import Toggle from "@cloudscape-design/components/toggle";
import { Channel } from "@tauri-apps/api/core";
import { useState, type ReactNode } from "react";
import { useReportUnsupported } from "../../capability";
import { commands, type LifecycleRuleInput, type PublicAccessBlock, type S3Version_Serialize, type TransferProgress } from "../../bindings";
import {
  CreateForm,
  dateTimeProperty,
  DeleteModal,
  DetailsPage,
  GatedButton,
  ResourceTable,
  textProperty,
  ScopeBanner,
  UiOnlyScope,
  useUiOnly,
  type ResourceTableColumn,
} from "../../patterns";
import { errorText } from "../../runtime/api";
import { ConsolePage, type HelpContent } from "../../shell/ConsolePage";
import { useNotifications } from "../../shell/notifications";
import { href, matchPath, navigate } from "../../shell/router";
import { regionName } from "../../shell/regions";
import {
  Copyable,
  EditTagsModal,
  formatBytes,
  formatDate,
  FormModal,
  JsonEditor,
  jsonError,
  LoadError,
  prettyJson,
  TagsTable,
  useAction,
  useLoad,
  useRegion,
} from "../common";

const NAV = {
  header: { text: "Amazon S3", href: href("/s3/buckets") },
  items: [{ type: "link" as const, text: "General purpose buckets", href: href("/s3/buckets") }],
};

const HELP: HelpContent = {
  header: "Amazon S3",
  body: (
    <SpaceBetween size="s">
      <Box variant="p">Buckets and objects of the local emulator. Every emulated resource is lost when the emulator stops.</Box>
      <Box variant="p">Uploads and downloads stream between a file on this computer and the emulator through the app; the file is chosen in a system dialog.</Box>
    </SpaceBetween>
  ),
};

function bucketHref(name: string, tab?: string, prefix?: string): string {
  return href(`/s3/buckets/${encodeURIComponent(name)}`, { tab, prefix });
}

function objectHref(bucket: string, key: string, versionId?: string): string {
  return href(`/s3/object/${encodeURIComponent(bucket)}`, { prefix: key, versionId });
}

function page(breadcrumbs: { text: string; href: string }[], content: ReactNode, contentType?: "table" | "form" | "default") {
  return <ConsolePage breadcrumbs={[{ text: "Amazon S3", href: href("/s3/buckets") }, ...breadcrumbs]} navigation={NAV} help={HELP} contentType={contentType} content={content} />;
}

// Transfers -----------------------------------------------------------------------------------

/** Upload and download with a Flashbar progress notice fed by the backend's progress channel. */
function useTransfers() {
  const { notify, dismiss } = useNotifications();
  const report = useReportUnsupported();
  const region = useRegion();

  const progressNotice = (id: string, verb: string, p: TransferProgress) =>
    notify({
      id,
      type: "in-progress",
      dismissible: false,
      header: `${verb} ${p.key}`,
      content: <ProgressBar value={p.total ? ((p.transferred ?? 0) / p.total) * 100 : 0} additionalInfo={`${formatBytes(p.transferred)} of ${formatBytes(p.total)}`} />,
    });

  const upload = async (bucket: string, prefix: string): Promise<boolean> => {
    const id = `s3-upload-${Date.now()}`;
    const channel = new Channel<TransferProgress>();
    channel.onmessage = (p) => progressNotice(id, "Uploading", p);
    try {
      const results = await commands.s3UploadFiles(region, bucket, prefix, channel);
      dismiss(id);
      if (!results.length) return false;
      const failed = results.filter((r) => r.error);
      const done = results.length - failed.length;
      // The emulator keeps a fixed number of object bytes per bucket, uploads in progress included,
      // and refuses a part or an object past it; its message carries the limit in bytes.
      const limited = failed.some((f) => f.error?.includes("this emulator keeps per bucket"));
      notify({
        type: failed.length ? "error" : "success",
        header: failed.length ? `Upload failed for ${failed.length} of ${results.length} files` : `Upload succeeded`,
        content: failed.length
          ? `${failed.map((f) => `${f.key}: ${f.error}`).join("; ")}${limited ? ". AWS Emulator holds a limited amount of object data per bucket, parts of uploads in progress included: delete objects or upload into another bucket." : ""}`
          : `${done} file${done === 1 ? "" : "s"}, ${formatBytes(results.reduce((n, r) => n + (r.size ?? 0), 0))}, uploaded to s3://${bucket}/${prefix}`,
      });
      return done > 0;
    } catch (e) {
      dismiss(id);
      report(e);
      notify({ type: "error", header: "Upload failed", content: errorText(e) });
      return false;
    }
  };

  const download = async (bucket: string, key: string, versionId?: string | null) => {
    const id = `s3-download-${Date.now()}`;
    const channel = new Channel<TransferProgress>();
    channel.onmessage = (p) => progressNotice(id, "Downloading", p);
    try {
      const result = await commands.s3DownloadObject(region, bucket, key, versionId ?? null, channel);
      dismiss(id);
      if (result) notify({ type: "success", header: "Download succeeded", content: `${key} (${formatBytes(result.size)}) saved to ${result.path}` });
    } catch (e) {
      dismiss(id);
      report(e);
      notify({ type: "error", header: "Download failed", content: errorText(e) });
    }
  };

  return { upload, download };
}

// Buckets ---------------------------------------------------------------------------------------

interface BucketRow {
  name: string;
  region: string;
  created: Date | null;
  createdText: string | null;
}

const BUCKET_COLUMNS: ResourceTableColumn<BucketRow>[] = [
  { id: "name", header: "Name", cell: (b) => <Link href={bucketHref(b.name)}>{b.name}</Link>, sortingField: "name", isRowHeader: true, alwaysVisible: true },
  { id: "region", header: "AWS Region", cell: (b) => (b.region ? `${regionName(b.region)} ${b.region}` : "-"), sortingField: "region" },
  { id: "created", header: "Creation date", cell: (b) => formatDate(b.createdText), sortingField: "created" },
];

const BUCKET_FILTERS = [textProperty("name", "Name"), textProperty("region", "AWS Region", "enum"), dateTimeProperty("created", "Creation date")];

function BucketsList() {
  const region = useRegion();
  const buckets = useLoad(() => commands.s3ListBuckets(region), []);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [emptying, setEmptying] = useState<string | null>(null);
  const { run } = useAction();
  const rows: BucketRow[] = (buckets.data ?? []).map((b) => ({ name: b.name, region: b.region ?? "", created: b.creation_date ? new Date(b.creation_date) : null, createdText: b.creation_date }));

  return (
    <SpaceBetween size="m">
      <LoadError error={buckets.error} onRetry={buckets.reload} />
      <ResourceTable<BucketRow>
        resourceName="Bucket"
        title="General purpose buckets"
        description="Buckets are containers for data stored in S3."
        help={HELP}
        items={rows}
        loading={buckets.loading}
        columns={BUCKET_COLUMNS}
        filteringProperties={BUCKET_FILTERS}
        trackBy="name"
        preferencesKey="s3.buckets"
        selectionType="single"
        onRefresh={buckets.reload}
        emptyAction={
          <GatedButton op="s3:CreateBucket" href={href("/s3/bucket/create")}>
            Create bucket
          </GatedButton>
        }
        actions={(selected) => (
          <SpaceBetween direction="horizontal" size="xs">
            <GatedButton op="s3:DeleteObjects" disabled={selected.length !== 1} onClick={() => setEmptying(selected[0].name)}>
              Empty
            </GatedButton>
            <GatedButton op="s3:DeleteBucket" disabled={selected.length !== 1} onClick={() => setDeleting(selected[0].name)}>
              Delete
            </GatedButton>
            <GatedButton variant="primary" op="s3:CreateBucket" href={href("/s3/bucket/create")}>
              Create bucket
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <DeleteModal
        visible={deleting !== null}
        resourceKind="bucket"
        names={deleting ? [deleting] : []}
        op="s3:DeleteBucket"
        confirmation="typed"
        warning="Buckets must be empty before they can be deleted. Use Empty first if this bucket holds objects."
        onDismiss={() => setDeleting(null)}
        onDelete={async () => {
          await commands.s3DeleteBucket(region, deleting!);
          buckets.reload();
        }}
      />
      <EmptyBucketModal
        bucket={emptying}
        onDismiss={() => setEmptying(null)}
        onEmpty={async (b) =>
          run(async () => {
            const r = await commands.s3EmptyBucket(region, b);
            if (r.errors.length) throw new Error(`${r.deleted} deleted, ${r.errors.length} failed: ${r.errors.join("; ")}`);
          }, `Bucket ${b} emptied`)
        }
      />
    </SpaceBetween>
  );
}

function EmptyBucketModal({ bucket, onDismiss, onEmpty }: { bucket: string | null; onDismiss: () => void; onEmpty: (bucket: string) => Promise<boolean> }) {
  const [typed, setTyped] = useState("");
  return (
    <FormModal
      visible={bucket !== null}
      header={`Empty bucket ${bucket ?? ""}`}
      op="s3:DeleteObjects"
      submitLabel="Empty"
      canSubmit={typed === "permanently delete"}
      onDismiss={() => {
        setTyped("");
        onDismiss();
      }}
      onSubmit={() => onEmpty(bucket!)}
    >
      <SpaceBetween size="m">
        <Box variant="p">Emptying the bucket deletes all objects, every object version and every delete marker in it. You can't undo this action.</Box>
        <FormField label='To confirm, enter "permanently delete" in the text input field.'>
          <Input value={typed} placeholder="permanently delete" onChange={({ detail }) => setTyped(detail.value)} />
        </FormField>
      </SpaceBetween>
    </FormModal>
  );
}

// Create bucket ---------------------------------------------------------------------------------

const BLOCK_ALL: PublicAccessBlock = { block_public_acls: true, ignore_public_acls: true, block_public_policy: true, restrict_public_buckets: true };

const BPA_LABELS: [keyof PublicAccessBlock, string, string][] = [
  ["block_public_acls", "Block public access to buckets and objects granted through new access control lists (ACLs)", "S3 will block public access permissions applied to newly added buckets or objects."],
  ["ignore_public_acls", "Block public access to buckets and objects granted through any access control lists (ACLs)", "S3 will ignore all ACLs that grant public access to buckets and objects."],
  ["block_public_policy", "Block public access to buckets and objects granted through new public bucket or access point policies", "S3 will block new bucket and access point policies that grant public access."],
  ["restrict_public_buckets", "Block public and cross-account access to buckets and objects through any public bucket or access point policies", "S3 will ignore public and cross-account access for buckets or access points with policies that grant public access."],
];

function BlockPublicAccessFields({ value, onChange }: { value: PublicAccessBlock; onChange: (v: PublicAccessBlock) => void }) {
  const all = BPA_LABELS.every(([k]) => value[k]);
  return (
    <SpaceBetween size="s">
      <Checkbox checked={all} indeterminate={!all && BPA_LABELS.some(([k]) => value[k])} onChange={({ detail }) => onChange(detail.checked ? BLOCK_ALL : { block_public_acls: false, ignore_public_acls: false, block_public_policy: false, restrict_public_buckets: false })} description="Turning this setting on is the same as turning on all four settings below.">
        <b>Block all public access</b>
      </Checkbox>
      <div style={{ paddingLeft: 24 }}>
        <SpaceBetween size="s">
          {BPA_LABELS.map(([k, label, description]) => (
            <Checkbox key={k} checked={value[k]} description={description} onChange={({ detail }) => onChange({ ...value, [k]: detail.checked })}>
              {label}
            </Checkbox>
          ))}
        </SpaceBetween>
      </div>
    </SpaceBetween>
  );
}

/** S3 general purpose bucket naming rules. */
function bucketNameError(name: string): string | undefined {
  if (name.length < 3 || name.length > 63) return "Bucket name must be between 3 and 63 characters long.";
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) return "Bucket name must use only lowercase letters, numbers, dots and hyphens, and begin and end with a letter or number.";
  if (name.includes("..")) return "Bucket name must not contain two adjacent periods.";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return "Bucket name must not be formatted as an IP address.";
  return undefined;
}

function CreateBucket() {
  const region = useRegion();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [bpa, setBpa] = useState<PublicAccessBlock>(BLOCK_ALL);
  const [versioning, setVersioning] = useState("disable");
  const [objectLock, setObjectLock] = useState("disable");
  const [tags, setTags] = useState<TagEditorProps.Tag[]>([]);
  const dirty = name !== "" || tags.length > 0 || versioning !== "disable" || objectLock !== "disable";

  return (
    <CreateForm
      title="Create bucket"
      description="Buckets are containers for data stored in S3."
      help={HELP}
      mode="create"
      submitLabel="Create bucket"
      op="s3:CreateBucket"
      dirty={dirty}
      cancelHref={href("/s3/buckets")}
      doneHref={bucketHref(name)}
      validate={() => {
        const e = bucketNameError(name);
        setNameError(e);
        return !e;
      }}
      onSubmit={async () => {
        await commands.s3CreateBucket(region, {
          name,
          versioning: versioning === "enable",
          object_lock: objectLock === "enable",
          public_access_block: bpa,
          tags: tags.filter((t) => !t.markedForRemoval && t.key).map((t) => ({ key: t.key, value: t.value })),
        });
      }}
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h2">General configuration</Header>}>
          <SpaceBetween size="l">
            <FormField label="AWS Region">
              <Box>
                {regionName(region)} {region}
              </Box>
            </FormField>
            <FormField label="Bucket name" description="Bucket names must be 3 to 63 characters and unique within the global namespace." errorText={nameError} constraintText="Bucket names can consist only of lowercase letters, numbers, periods (.), and hyphens (-).">
              <Input value={name} placeholder="myawsbucket" onChange={({ detail }) => setName(detail.value)} />
            </FormField>
          </SpaceBetween>
        </Container>
        <Container header={<Header variant="h2" description="Public access is granted to buckets and objects through access control lists (ACLs), bucket policies, access point policies, or all.">Block Public Access settings for this bucket</Header>}>
          <BlockPublicAccessFields value={bpa} onChange={setBpa} />
        </Container>
        <Container header={<Header variant="h2" description="Versioning is a means of keeping multiple variants of an object in the same bucket.">Bucket Versioning</Header>}>
          <RadioGroup value={objectLock === "enable" ? "enable" : versioning} onChange={({ detail }) => setVersioning(detail.value)} items={[{ value: "disable", label: "Disable", disabled: objectLock === "enable" }, { value: "enable", label: "Enable" }]} />
        </Container>
        <Container header={<Header variant="h2" description="You can use bucket tags to track storage costs and organize buckets.">Tags - optional</Header>}>
          <TagEditor tags={tags} onChange={({ detail }) => setTags([...detail.tags])} tagLimit={50} i18nStrings={{ tagLimit: (n) => `You can add up to ${n} more tags.` }} />
        </Container>
        <Container header={<Header variant="h2">Advanced settings</Header>}>
          <FormField label="Object Lock" description="Store objects using a write-once-read-many (WORM) model to help you prevent objects from being deleted or overwritten. Object Lock also enables Bucket Versioning.">
            <RadioGroup value={objectLock} onChange={({ detail }) => setObjectLock(detail.value)} items={[{ value: "disable", label: "Disable" }, { value: "enable", label: "Enable", description: "Permanently allows objects in this bucket to be locked." }]} />
          </FormField>
        </Container>
      </SpaceBetween>
    </CreateForm>
  );
}

// Bucket details: Objects -----------------------------------------------------------------------

interface ObjectRow {
  key: string;
  name: string;
  folder: boolean;
  type: string;
  size: number;
  modified: Date | null;
  modifiedText: string | null;
  storageClass: string;
}

function ObjectsTab({ bucket, prefix }: { bucket: string; prefix: string }) {
  const region = useRegion();
  const transfers = useTransfers();
  const { run } = useAction();
  const listing = useLoad(async () => {
    const folders: string[] = [];
    const objects: Awaited<ReturnType<typeof commands.s3ListObjects>>["objects"] = [];
    let token: string | null = null;
    // Up to 20 pages of 1000 keys: enough for a local bucket level without an unbounded loop.
    for (let i = 0; i < 20; i++) {
      const page = await commands.s3ListObjects(region, bucket, prefix, token);
      folders.push(...page.folders);
      objects.push(...page.objects);
      token = page.next_token;
      if (!token) break;
    }
    return { folders, objects };
  }, [bucket, prefix]);
  const [selected, setSelected] = useState<readonly ObjectRow[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [typed, setTyped] = useState("");

  const rows: ObjectRow[] = [
    ...(listing.data?.folders ?? []).map((f) => ({ key: f, name: f.slice(prefix.length), folder: true, type: "Folder", size: 0, modified: null, modifiedText: null, storageClass: "-" })),
    ...(listing.data?.objects ?? []).map((o) => {
      const name = o.key.slice(prefix.length);
      const dot = name.lastIndexOf(".");
      return { key: o.key, name, folder: false, type: dot > 0 ? name.slice(dot + 1) : "-", size: o.size ?? 0, modified: o.last_modified ? new Date(o.last_modified) : null, modifiedText: o.last_modified, storageClass: o.storage_class ?? "STANDARD" };
    }),
  ];
  const columns: ResourceTableColumn<ObjectRow>[] = [
    {
      id: "name",
      header: "Name",
      isRowHeader: true,
      alwaysVisible: true,
      sortingField: "name",
      cell: (r) => (r.folder ? <Link href={bucketHref(bucket, "objects", r.key)}>{r.name}</Link> : <Link href={objectHref(bucket, r.key)}>{r.name}</Link>),
    },
    { id: "type", header: "Type", cell: (r) => r.type, sortingField: "type" },
    { id: "modified", header: "Last modified", cell: (r) => formatDate(r.modifiedText), sortingField: "modified" },
    { id: "size", header: "Size", cell: (r) => (r.folder ? "-" : formatBytes(r.size)), sortingField: "size" },
    { id: "storage", header: "Storage class", cell: (r) => r.storageClass, sortingField: "storageClass" },
  ];
  const one = selected.length === 1 && !selected[0].folder ? selected[0] : null;
  const parts = prefix.split("/").filter(Boolean);

  return (
    <SpaceBetween size="m">
      {prefix !== "" && (
        <BreadcrumbGroup
          ariaLabel="Folder path"
          items={[{ text: bucket, href: bucketHref(bucket, "objects") }, ...parts.map((p, i) => ({ text: p, href: bucketHref(bucket, "objects", `${parts.slice(0, i + 1).join("/")}/`) }))]}
        />
      )}
      <LoadError error={listing.error} onRetry={listing.reload} />
      <ResourceTable<ObjectRow>
        resourceName="Object"
        title="Objects"
        description="Objects are the fundamental entities stored in Amazon S3."
        variant="container"
        items={rows}
        loading={listing.loading}
        columns={columns}
        filteringProperties={[textProperty("name", "Name"), textProperty("type", "Type", "enum"), dateTimeProperty("modified", "Last modified")]}
        trackBy="key"
        preferencesKey="s3.objects"
        selectionType="multi"
        onSelectionChange={setSelected}
        onRefresh={listing.reload}
        emptyAction={
          <GatedButton op="s3:PutObject" onClick={async () => (await transfers.upload(bucket, prefix)) && listing.reload()}>
            Upload
          </GatedButton>
        }
        actions={(sel) => (
          <SpaceBetween direction="horizontal" size="xs">
            <Copyable value={one ? `s3://${bucket}/${one.key}` : `s3://${bucket}/${prefix}`} label="S3 URI" />
            <GatedButton op="s3:GetObject" disabled={!one} onClick={() => one && transfers.download(bucket, one.key)}>
              Download
            </GatedButton>
            <GatedButton op="s3:DeleteObjects" disabled={sel.length === 0} onClick={() => setDeleting(true)}>
              Delete
            </GatedButton>
            <GatedButton op="s3:PutObject" onClick={() => setCreatingFolder(true)}>
              Create folder
            </GatedButton>
            <GatedButton variant="primary" op="s3:PutObject" onClick={async () => (await transfers.upload(bucket, prefix)) && listing.reload()}>
              Upload
            </GatedButton>
          </SpaceBetween>
        )}
      />
      <FormModal
        visible={deleting}
        header="Delete objects"
        op="s3:DeleteObjects"
        submitLabel="Delete objects"
        canSubmit={typed === "permanently delete"}
        onDismiss={() => {
          setDeleting(false);
          setTyped("");
        }}
        onSubmit={() =>
          run(async () => {
            const r = await commands.s3DeleteObjects(region, bucket, selected.filter((s) => !s.folder).map((s) => s.key), selected.filter((s) => s.folder).map((s) => s.key));
            listing.reload();
            if (r.errors.length) throw new Error(`${r.deleted} deleted, ${r.errors.length} failed: ${r.errors.join("; ")}`);
          }, `Deleted ${selected.length} item${selected.length === 1 ? "" : "s"}`)
        }
      >
        <SpaceBetween size="m">
          <Box variant="p">
            Deleting {selected.length} item{selected.length === 1 ? "" : "s"}
            {selected.some((s) => s.folder) ? ", and every object in the selected folders," : ""} can't be undone. In a versioned bucket, delete markers are added instead.
          </Box>
          <ul>
            {selected.slice(0, 10).map((s) => (
              <li key={s.key}>{s.key}</li>
            ))}
            {selected.length > 10 && <li>and {selected.length - 10} more</li>}
          </ul>
          <FormField label='To confirm deletion, type "permanently delete" in the text input field.'>
            <Input value={typed} placeholder="permanently delete" onChange={({ detail }) => setTyped(detail.value)} />
          </FormField>
        </SpaceBetween>
      </FormModal>
      <FormModal
        visible={creatingFolder}
        header="Create folder"
        op="s3:PutObject"
        submitLabel="Create folder"
        canSubmit={/^[^/]+$/.test(folderName)}
        onDismiss={() => {
          setCreatingFolder(false);
          setFolderName("");
        }}
        onSubmit={() =>
          run(async () => {
            await commands.s3CreateFolder(region, bucket, `${prefix}${folderName}/`);
            listing.reload();
          }, `Folder ${folderName} created`)
        }
      >
        <FormField label="Folder name" constraintText="Folder names can't contain /." description={`s3://${bucket}/${prefix}`}>
          <Input value={folderName} onChange={({ detail }) => setFolderName(detail.value)} />
        </FormField>
      </FormModal>
    </SpaceBetween>
  );
}

// Bucket details: Properties --------------------------------------------------------------------

function PropertiesTab({ bucket }: { bucket: string }) {
  const region = useRegion();
  const { run } = useAction();
  const location = useLoad(() => commands.s3GetBucketLocation(region, bucket), [bucket]);
  const versioning = useLoad(() => commands.s3GetBucketVersioning(region, bucket), [bucket]);
  const tags = useLoad(() => commands.s3GetBucketTagging(region, bucket), [bucket]);
  const created = useLoad(async () => (await commands.s3ListBuckets(region)).find((b) => b.name === bucket)?.creation_date ?? null, [bucket]);
  const [editVersioning, setEditVersioning] = useState(false);
  const [versioningValue, setVersioningValue] = useState("Enabled");
  const [editTags, setEditTags] = useState(false);

  return (
    <SpaceBetween size="l">
      <LoadError error={location.error ?? versioning.error ?? tags.error} />
      <Container header={<Header variant="h2">Bucket overview</Header>}>
        <KeyValuePairs
          columns={3}
          items={[
            { label: "AWS Region", value: location.data ? `${regionName(location.data)} ${location.data}` : "-" },
            { label: "Amazon Resource Name (ARN)", value: <Copyable value={`arn:aws:s3:::${bucket}`} label="ARN" /> },
            { label: "Creation date", value: formatDate(created.data) },
          ]}
        />
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            description="Versioning is a means of keeping multiple variants of an object in the same bucket."
            actions={
              <GatedButton
                op="s3:PutBucketVersioning"
                onClick={() => {
                  setVersioningValue(versioning.data === "Enabled" ? "Enabled" : "Suspended");
                  setEditVersioning(true);
                }}
              >
                Edit
              </GatedButton>
            }
          >
            Bucket Versioning
          </Header>
        }
      >
        <KeyValuePairs items={[{ label: "Bucket Versioning", value: versioning.data ?? "-" }]} />
      </Container>
      <TagsTable tags={tags.data} loading={tags.loading} op="s3:PutBucketTagging" onEdit={() => setEditTags(true)} description="You can use bucket tags to track storage costs and organize buckets." />
      <UiOnlyScope primaryOp="s3:GetBucketEncryption">
        <Container header={<Header variant="h2" description="Server-side encryption is automatically applied to new objects stored in this bucket.">Default encryption</Header>}>
          <DefaultEncryption bucket={bucket} />
        </Container>
      </UiOnlyScope>
      <FormModal
        visible={editVersioning}
        header="Edit Bucket Versioning"
        op="s3:PutBucketVersioning"
        onDismiss={() => setEditVersioning(false)}
        onSubmit={() =>
          run(async () => {
            await commands.s3PutBucketVersioning(region, bucket, versioningValue === "Enabled");
            versioning.reload();
          }, "Bucket Versioning updated")
        }
      >
        <RadioGroup
          value={versioningValue}
          onChange={({ detail }) => setVersioningValue(detail.value)}
          items={[
            { value: "Suspended", label: "Suspend", description: "This suspends the creation of object versions for all operations but preserves any existing object versions." },
            { value: "Enabled", label: "Enable" },
          ]}
        />
      </FormModal>
      <EditTagsModal
        visible={editTags}
        tags={tags.data ?? []}
        op="s3:PutBucketTagging"
        onDismiss={() => setEditTags(false)}
        onSave={(next) =>
          run(async () => {
            await commands.s3PutBucketTagging(region, bucket, next);
            tags.reload();
          }, "Bucket tags updated")
        }
      />
    </SpaceBetween>
  );
}

function DefaultEncryption({ bucket }: { bucket: string }) {
  const region = useRegion();
  const enc = useLoad(() => commands.s3GetBucketEncryption(region, bucket), [bucket]);
  const { uiOnly } = useUiOnly();
  const algorithm = enc.data?.algorithm;
  const type = algorithm === "AES256" ? "Server-side encryption with Amazon S3 managed keys (SSE-S3)" : algorithm === "aws:kms" ? "Server-side encryption with AWS Key Management Service keys (SSE-KMS)" : algorithm === "aws:kms:dsse" ? "Dual-layer server-side encryption with AWS KMS keys (DSSE-KMS)" : (algorithm ?? "-");
  return (
    <SpaceBetween size="m">
      <ScopeBanner />
      <LoadError error={enc.error} />
      {!uiOnly && (
        <KeyValuePairs
          columns={3}
          items={[
            { label: "Encryption type", value: enc.loading ? "-" : enc.data ? type : "No default encryption configured" },
            { label: "Bucket Key", value: enc.data ? (enc.data.bucket_key ? "Enabled" : "Disabled") : "-" },
            { label: "AWS KMS key", value: enc.data?.kms_key_id ?? "-" },
          ]}
        />
      )}
    </SpaceBetween>
  );
}

// Bucket details: Permissions -------------------------------------------------------------------

function PermissionsTab({ bucket }: { bucket: string }) {
  const region = useRegion();
  const { run } = useAction();
  const bpa = useLoad(() => commands.s3GetPublicAccessBlock(region, bucket), [bucket]);
  const policy = useLoad(() => commands.s3GetBucketPolicy(region, bucket), [bucket]);
  const cors = useLoad(() => commands.s3GetBucketCors(region, bucket), [bucket]);
  const [editing, setEditing] = useState<"bpa" | "policy" | "cors" | null>(null);
  const [bpaValue, setBpaValue] = useState<PublicAccessBlock>(BLOCK_ALL);
  const [text, setText] = useState("");
  const onOff = (v: boolean | undefined) => (v === undefined ? "-" : <StatusIndicator type={v ? "success" : "warning"}>{v ? "On" : "Off"}</StatusIndicator>);

  return (
    <SpaceBetween size="l">
      <LoadError error={bpa.error ?? policy.error ?? cors.error} />
      <Container
        header={
          <Header
            variant="h2"
            description="Public access is granted to buckets and objects through access control lists (ACLs), bucket policies, access point policies, or all."
            actions={
              <GatedButton
                op="s3:PutPublicAccessBlock"
                onClick={() => {
                  setBpaValue(bpa.data ?? BLOCK_ALL);
                  setEditing("bpa");
                }}
              >
                Edit
              </GatedButton>
            }
          >
            Block public access (bucket settings)
          </Header>
        }
      >
        <SpaceBetween size="s">
          <KeyValuePairs items={[{ label: "Block all public access", value: bpa.data ? onOff(BPA_LABELS.every(([k]) => bpa.data![k])) : "-" }]} />
          <KeyValuePairs columns={2} items={BPA_LABELS.map(([k, label]) => ({ label, value: onOff(bpa.data?.[k]) }))} />
        </SpaceBetween>
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            description="The bucket policy, written in JSON, provides access to the objects stored in the bucket."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="s3:DeleteBucketPolicy" disabled={!policy.data} onClick={() => run(async () => { await commands.s3PutBucketPolicy(region, bucket, ""); policy.reload(); }, "Bucket policy deleted")}>
                  Delete
                </GatedButton>
                <GatedButton
                  op="s3:PutBucketPolicy"
                  onClick={() => {
                    setText(prettyJson(policy.data));
                    setEditing("policy");
                  }}
                >
                  Edit
                </GatedButton>
              </SpaceBetween>
            }
          >
            Bucket policy
          </Header>
        }
      >
        {policy.data ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{prettyJson(policy.data)}</pre> : <Box color="text-status-inactive">No policy to display.</Box>}
      </Container>
      <Container
        header={
          <Header
            variant="h2"
            description="The CORS configuration, written in JSON, defines a way for client web applications that are loaded in one domain to interact with resources in a different domain."
            actions={
              <GatedButton
                op="s3:PutBucketCors"
                onClick={() => {
                  setText(cors.data ?? "");
                  setEditing("cors");
                }}
              >
                Edit
              </GatedButton>
            }
          >
            Cross-origin resource sharing (CORS)
          </Header>
        }
      >
        {cors.data ? <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{cors.data}</pre> : <Box color="text-status-inactive">No configurations to display.</Box>}
      </Container>
      <FormModal
        visible={editing === "bpa"}
        size="large"
        header="Edit Block public access (bucket settings)"
        op="s3:PutPublicAccessBlock"
        onDismiss={() => setEditing(null)}
        onSubmit={() => run(async () => { await commands.s3PutPublicAccessBlock(region, bucket, bpaValue); bpa.reload(); }, "Block public access settings updated")}
      >
        <BlockPublicAccessFields value={bpaValue} onChange={setBpaValue} />
      </FormModal>
      <FormModal
        visible={editing === "policy" || editing === "cors"}
        size="large"
        header={editing === "policy" ? "Edit bucket policy" : "Edit cross-origin resource sharing (CORS)"}
        op={editing === "policy" ? "s3:PutBucketPolicy" : "s3:PutBucketCors"}
        canSubmit={!jsonError(text)}
        onDismiss={() => setEditing(null)}
        onSubmit={() =>
          run(async () => {
            if (editing === "policy") {
              await commands.s3PutBucketPolicy(region, bucket, text);
              policy.reload();
            } else {
              await commands.s3PutBucketCors(region, bucket, text);
              cors.reload();
            }
          }, editing === "policy" ? "Bucket policy updated" : "CORS configuration updated")
        }
      >
        <JsonEditor
          label={editing === "policy" ? "Policy" : "Cross-origin resource sharing (CORS)"}
          description={editing === "policy" ? "An empty policy deletes it." : 'A JSON array of rules, for example [{"AllowedMethods": ["GET"], "AllowedOrigins": ["*"]}]. An empty array deletes the configuration.'}
          value={text}
          onChange={setText}
          rows={18}
        />
      </FormModal>
    </SpaceBetween>
  );
}

// Bucket details: Management --------------------------------------------------------------------

const NEW_RULE: LifecycleRuleInput = { id: "", enabled: true, prefix: "", expiration_days: null, noncurrent_expiration_days: null, abort_multipart_days: null };

function daysInput(value: number | null | undefined, onChange: (v: number | null) => void) {
  return <Input type="number" inputMode="numeric" value={value ? String(value) : ""} onChange={({ detail }) => onChange(detail.value ? Math.max(1, parseInt(detail.value, 10) || 1) : null)} />;
}

function ManagementTab({ bucket }: { bucket: string }) {
  const region = useRegion();
  const { run } = useAction();
  const rules = useLoad(() => commands.s3GetBucketLifecycle(region, bucket), [bucket]);
  const [selected, setSelected] = useState<LifecycleRuleInput[]>([]);
  const [editing, setEditing] = useState<LifecycleRuleInput | null>(null);
  const { uiOnly } = useUiOnly();
  const all = rules.data ?? [];
  const save = (next: LifecycleRuleInput[], message: string) =>
    run(async () => {
      await commands.s3PutBucketLifecycle(region, bucket, next);
      setSelected([]);
      rules.reload();
    }, message);

  return (
    <SpaceBetween size="m">
      <LoadError error={rules.error} onRetry={rules.reload} />
      <Table<LifecycleRuleInput>
        variant="container"
        items={uiOnly ? [] : all}
        loading={rules.loading}
        loadingText="Loading lifecycle rules"
        trackBy="id"
        selectionType="single"
        selectedItems={selected}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems)}
        columnDefinitions={[
          { id: "id", header: "Lifecycle rule name", cell: (r) => r.id, isRowHeader: true },
          { id: "status", header: "Status", cell: (r) => <StatusIndicator type={r.enabled ? "success" : "stopped"}>{r.enabled ? "Enabled" : "Disabled"}</StatusIndicator> },
          { id: "scope", header: "Scope", cell: (r) => (r.prefix ? `Prefix ${r.prefix}` : "Entire bucket") },
          { id: "expire", header: "Expire current versions", cell: (r) => (r.expiration_days ? `${r.expiration_days} days` : "-") },
          { id: "noncurrent", header: "Permanently delete noncurrent versions", cell: (r) => (r.noncurrent_expiration_days ? `${r.noncurrent_expiration_days} days` : "-") },
          { id: "abort", header: "Delete incomplete multipart uploads", cell: (r) => (r.abort_multipart_days ? `${r.abort_multipart_days} days` : "-") },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <b>No lifecycle rules</b>
            <Box variant="p" color="inherit">
              There are no lifecycle rules for this bucket.
            </Box>
          </Box>
        }
        header={
          <Header
            variant="h2"
            counter={`(${all.length})`}
            description="Use lifecycle rules to define actions you want Amazon S3 to take during an object's lifetime."
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <GatedButton op="s3:PutBucketLifecycleConfiguration" disabled={selected.length !== 1} onClick={() => setEditing({ ...selected[0] })}>
                  Edit
                </GatedButton>
                <GatedButton op="s3:PutBucketLifecycleConfiguration" disabled={selected.length !== 1} onClick={() => save(all.filter((r) => r.id !== selected[0].id), `Lifecycle rule ${selected[0].id} deleted`)}>
                  Delete
                </GatedButton>
                <GatedButton variant="primary" op="s3:PutBucketLifecycleConfiguration" onClick={() => setEditing({ ...NEW_RULE })}>
                  Create lifecycle rule
                </GatedButton>
              </SpaceBetween>
            }
          >
            Lifecycle rules
          </Header>
        }
      />
      <FormModal
        visible={editing !== null}
        size="large"
        header={editing && all.some((r) => r.id === editing.id) ? `Edit lifecycle rule ${editing.id}` : "Create lifecycle rule"}
        op="s3:PutBucketLifecycleConfiguration"
        submitLabel="Save changes"
        canSubmit={!!editing?.id && !!(editing.expiration_days || editing.noncurrent_expiration_days || editing.abort_multipart_days)}
        onDismiss={() => setEditing(null)}
        onSubmit={() => save([...all.filter((r) => r.id !== editing!.id), editing!], `Lifecycle rule ${editing!.id} saved`)}
      >
        {editing && (
          <SpaceBetween size="m">
            <FormField label="Lifecycle rule name">
              <Input value={editing.id} onChange={({ detail }) => setEditing({ ...editing, id: detail.value })} />
            </FormField>
            <Toggle checked={editing.enabled} onChange={({ detail }) => setEditing({ ...editing, enabled: detail.checked })}>
              Enabled
            </Toggle>
            <FormField label="Prefix" description="Leave empty to apply the rule to all objects in the bucket.">
              <Input value={editing.prefix} onChange={({ detail }) => setEditing({ ...editing, prefix: detail.value })} />
            </FormField>
            <FormField label="Expire current versions of objects (days after object creation)">{daysInput(editing.expiration_days, (v) => setEditing({ ...editing, expiration_days: v }))}</FormField>
            <FormField label="Permanently delete noncurrent versions of objects (days after objects become noncurrent)">{daysInput(editing.noncurrent_expiration_days, (v) => setEditing({ ...editing, noncurrent_expiration_days: v }))}</FormField>
            <FormField label="Delete incomplete multipart uploads (days after initiation)">{daysInput(editing.abort_multipart_days, (v) => setEditing({ ...editing, abort_multipart_days: v }))}</FormField>
          </SpaceBetween>
        )}
      </FormModal>
    </SpaceBetween>
  );
}

function BucketDetails({ bucket, prefix }: { bucket: string; prefix: string }) {
  return (
    <UiOnlyScope primaryOp="s3:ListObjectsV2">
      <DetailsPage
        title={bucket}
        help={HELP}
        layout="tabs"
        sections={[
          { id: "objects", label: "Objects", content: <ObjectsTab bucket={bucket} prefix={prefix} /> },
          { id: "properties", label: "Properties", content: <PropertiesTab bucket={bucket} /> },
          { id: "permissions", label: "Permissions", content: <PermissionsTab bucket={bucket} /> },
          { id: "management", label: "Management", content: <ManagementTab bucket={bucket} /> },
        ]}
      />
    </UiOnlyScope>
  );
}

// Object details --------------------------------------------------------------------------------

function ObjectDetails({ bucket, objectKey, versionId }: { bucket: string; objectKey: string; versionId?: string }) {
  const region = useRegion();
  const transfers = useTransfers();
  const { run } = useAction();
  const head = useLoad(() => commands.s3HeadObject(region, bucket, objectKey, versionId ?? null), [bucket, objectKey, versionId]);
  const tags = useLoad(() => commands.s3GetObjectTagging(region, bucket, objectKey), [bucket, objectKey]);
  const versions = useLoad(() => commands.s3ListObjectVersions(region, bucket, objectKey), [bucket, objectKey]);
  const [editTags, setEditTags] = useState(false);
  const [deleting, setDeleting] = useState<S3Version_Serialize | null>(null);
  const d = head.data;
  const name = objectKey.slice(objectKey.lastIndexOf("/") + 1);

  const versionColumns: ResourceTableColumn<S3Version_Serialize & { modified: Date | null }>[] = [
    {
      id: "version",
      header: "Version ID",
      isRowHeader: true,
      alwaysVisible: true,
      cell: (v) => (v.delete_marker ? `${v.version_id} (Delete marker)` : <Link href={objectHref(bucket, objectKey, v.version_id)}>{v.version_id}</Link>),
    },
    { id: "latest", header: "Current version", cell: (v) => (v.is_latest ? <StatusIndicator type="success">Current version</StatusIndicator> : "-") },
    { id: "modified", header: "Last modified", cell: (v) => formatDate(v.last_modified), sortingField: "modified" },
    { id: "size", header: "Size", cell: (v) => (v.delete_marker ? "-" : formatBytes(v.size)), sortingField: "size" },
  ];

  return (
    <DetailsPage
      title={name}
      help={HELP}
      layout="tabs"
      actions={
        <SpaceBetween direction="horizontal" size="xs">
          <Copyable value={`s3://${bucket}/${objectKey}`} label="S3 URI" />
          <GatedButton op="s3:GetObject" onClick={() => transfers.download(bucket, objectKey, versionId)}>
            Download
          </GatedButton>
        </SpaceBetween>
      }
      sections={[
        {
          id: "properties",
          label: "Properties",
          content: (
            <SpaceBetween size="l">
              <LoadError error={head.error} onRetry={head.reload} />
              <Container header={<Header variant="h2">Object overview</Header>}>
                <KeyValuePairs
                  columns={3}
                  items={[
                    { label: "AWS Region", value: `${regionName(region)} ${region}` },
                    { label: "Last modified", value: formatDate(d?.last_modified) },
                    { label: "Size", value: d ? formatBytes(d.size) : "-" },
                    { label: "Type", value: d?.content_type ?? "-" },
                    { label: "Key", value: <Copyable value={objectKey} label="Key" /> },
                    { label: "S3 URI", value: <Copyable value={`s3://${bucket}/${objectKey}`} label="S3 URI" /> },
                    { label: "Amazon Resource Name (ARN)", value: <Copyable value={`arn:aws:s3:::${bucket}/${objectKey}`} label="ARN" /> },
                    { label: "Entity tag (Etag)", value: d?.etag ?? "-" },
                    { label: "Version ID", value: d?.version_id ?? "-" },
                    { label: "Storage class", value: d?.storage_class ?? "Standard" },
                    { label: "Server-side encryption", value: d?.server_side_encryption ?? "-" },
                  ]}
                />
              </Container>
              <Table
                variant="container"
                items={d?.metadata ?? []}
                trackBy="key"
                columnDefinitions={[
                  { id: "key", header: "Key", cell: (m) => `x-amz-meta-${m.key}`, isRowHeader: true },
                  { id: "value", header: "Value", cell: (m) => m.value },
                ]}
                empty={<Box textAlign="center" color="inherit">No user-defined metadata.</Box>}
                header={<Header variant="h2" description="User-defined metadata stored with the object.">Metadata</Header>}
              />
              <TagsTable tags={tags.data} loading={tags.loading} op="s3:PutObjectTagging" onEdit={() => setEditTags(true)} />
              <EditTagsModal
                visible={editTags}
                tags={tags.data ?? []}
                op="s3:PutObjectTagging"
                onDismiss={() => setEditTags(false)}
                onSave={(next) =>
                  run(async () => {
                    await commands.s3PutObjectTagging(region, bucket, objectKey, next);
                    tags.reload();
                  }, "Object tags updated")
                }
              />
            </SpaceBetween>
          ),
        },
        {
          id: "versions",
          label: "Versions",
          content: (
            <SpaceBetween size="m">
              <LoadError error={versions.error} onRetry={versions.reload} />
              <ResourceTable
                resourceName="Version"
                title="Versions"
                variant="container"
                items={(versions.data ?? []).map((v) => ({ ...v, modified: v.last_modified ? new Date(v.last_modified) : null }))}
                loading={versions.loading}
                columns={versionColumns}
                filteringProperties={[textProperty("version_id", "Version ID")]}
                trackBy="version_id"
                preferencesKey="s3.versions"
                selectionType="single"
                onRefresh={versions.reload}
                actions={(sel) => (
                  <SpaceBetween direction="horizontal" size="xs">
                    <GatedButton op="s3:GetObject" disabled={sel.length !== 1 || sel[0].delete_marker} onClick={() => transfers.download(bucket, objectKey, sel[0].version_id)}>
                      Download
                    </GatedButton>
                    <GatedButton op="s3:DeleteObject" disabled={sel.length !== 1} onClick={() => setDeleting(sel[0])}>
                      Delete
                    </GatedButton>
                  </SpaceBetween>
                )}
              />
              <DeleteModal
                visible={deleting !== null}
                resourceKind="object version"
                names={deleting ? [deleting.version_id] : []}
                op="s3:DeleteObject"
                confirmation="simple"
                warning="Deleting a specific version permanently removes it."
                onDismiss={() => setDeleting(null)}
                onDelete={async () => {
                  await commands.s3DeleteObjectVersion(region, bucket, objectKey, deleting!.version_id);
                  versions.reload();
                  if (deleting!.version_id === versionId) navigate(objectHref(bucket, objectKey));
                }}
              />
            </SpaceBetween>
          ),
        },
      ]}
    />
  );
}

// Routes ----------------------------------------------------------------------------------------

/** The S3 page for a route path, or null when the path is not an S3 page. */
export function s3Page(path: string, query: URLSearchParams): ReactNode | null {
  if (path === "/s3" || path === "/s3/buckets") return page([{ text: "General purpose buckets", href: href("/s3/buckets") }], <UiOnlyScope primaryOp="s3:ListBuckets"><BucketsList /></UiOnlyScope>, "table");
  if (path === "/s3/bucket/create")
    return page([{ text: "General purpose buckets", href: href("/s3/buckets") }, { text: "Create bucket", href: href("/s3/bucket/create") }], <CreateBucket />, "form");
  const bucket = matchPath("/s3/buckets/:name", path);
  if (bucket)
    return page(
      [{ text: "General purpose buckets", href: href("/s3/buckets") }, { text: bucket.name, href: bucketHref(bucket.name) }],
      <BucketDetails key={bucket.name} bucket={bucket.name} prefix={query.get("prefix") ?? ""} />,
    );
  const object = matchPath("/s3/object/:bucket", path);
  const key = query.get("prefix");
  if (object && key) {
    const parts = key.split("/");
    return page(
      [
        { text: "General purpose buckets", href: href("/s3/buckets") },
        { text: object.bucket, href: bucketHref(object.bucket) },
        ...parts.slice(0, -1).map((p, i) => ({ text: p, href: bucketHref(object.bucket, "objects", `${parts.slice(0, i + 1).join("/")}/`) })),
        { text: parts[parts.length - 1], href: objectHref(object.bucket, key) },
      ],
      <UiOnlyScope primaryOp="s3:HeadObject">
        <ObjectDetails key={`${object.bucket}/${key}/${query.get("versionId") ?? ""}`} bucket={object.bucket} objectKey={key} versionId={query.get("versionId") ?? undefined} />
      </UiOnlyScope>,
    );
  }
  return null;
}
