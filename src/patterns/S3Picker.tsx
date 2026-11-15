// Adapted from cloudscape-design/demos (MIT-0): pages/read-from-s3 and pages/write-to-s3.

import Alert from "@cloudscape-design/components/alert";
import FormField from "@cloudscape-design/components/form-field";
import S3ResourceSelector, { type S3ResourceSelectorProps } from "@cloudscape-design/components/s3-resource-selector";
import { useState } from "react";
import { useReportUnsupported } from "../capability";
import { errorText } from "../runtime/api";

/** Loads buckets, objects and versions; Phase 4 supplies these from the backend's S3 commands. */
export interface S3Source {
  buckets: () => Promise<S3ResourceSelectorProps.Bucket[]>;
  objects: (bucket: string, path: string) => Promise<S3ResourceSelectorProps.Object[]>;
  versions?: (bucket: string, path: string) => Promise<S3ResourceSelectorProps.Version[]>;
}

export interface S3PickerProps {
  /** `read` picks an object (or version); `write` picks a bucket or prefix to write into. */
  mode: "read" | "write";
  label: string;
  description?: string;
  value: string;
  onChange: (uri: string, error?: string) => void;
  source: S3Source;
}

/** The console's S3 location picker: a URI field with a browse modal over buckets and objects. */
export function S3Picker({ mode, label, description, value, onChange, source }: S3PickerProps) {
  const reportUnsupported = useReportUnsupported();
  const [error, setError] = useState<string>();
  const [fetchError, setFetchError] = useState<string>();

  const guarded = async <T,>(load: () => Promise<T>): Promise<T> => {
    setFetchError(undefined);
    try {
      return await load();
    } catch (err) {
      reportUnsupported(err);
      setFetchError(errorText(err));
      throw err;
    }
  };

  return (
    <FormField
      label={label}
      description={description}
      constraintText={mode === "read" ? "Use s3://bucket/prefix/object format." : "Use s3://bucket/prefix format."}
      errorText={error}
      stretch
    >
      <S3ResourceSelector
        alert={fetchError && <Alert type="error" header="Could not load from Amazon S3">{fetchError}</Alert>}
        resource={{ uri: value }}
        selectableItemsTypes={mode === "read" ? ["objects", "versions"] : ["buckets", "objects"]}
        objectsIsItemDisabled={mode === "read" ? (o) => o.IsFolder === true : (o) => o.IsFolder !== true}
        bucketsVisibleColumns={["Name", "CreationDate"]}
        i18nStrings={{ inContextInputPlaceholder: mode === "read" ? "s3://bucket/prefix/object" : "s3://bucket/prefix" }}
        fetchBuckets={() => guarded(source.buckets)}
        fetchObjects={(bucket, path) => guarded(() => source.objects(bucket, path))}
        fetchVersions={(bucket, path) => guarded(() => source.versions?.(bucket, path) ?? Promise.resolve([]))}
        onChange={({ detail }) => {
          setError(detail.errorText);
          onChange(detail.resource.uri, detail.errorText);
        }}
      />
    </FormField>
  );
}
