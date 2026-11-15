// Adapted from cloudscape-design/demos (MIT-0): pages/manage-tags.

import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import TagEditor, { type TagEditorProps } from "@cloudscape-design/components/tag-editor";
import { useEffect, useState } from "react";
import { CreateForm } from "./CreateForm";

export interface Tag {
  key: string;
  value: string;
}

export interface ManageTagsProps {
  /** Tags the resource has now; `aws:` tags are system tags and are not editable. */
  tags: Tag[] | null;
  loading?: boolean;
  /** `service:Operation` that writes the tags, for example `sqs:TagQueue`. */
  op: string;
  /** Saves the difference: tags to set and keys to remove. */
  onSave: (set: Tag[], removedKeys: string[]) => Promise<void>;
  cancelHref: string;
  tagLimit?: number;
}

function diff(before: Tag[], after: TagEditorProps.Tag[]) {
  const kept = after.filter((t) => !t.markedForRemoval);
  const set = kept.filter((t) => before.find((b) => b.key === t.key)?.value !== t.value).map((t) => ({ key: t.key, value: t.value }));
  const removedKeys = before.filter((b) => !kept.some((t) => t.key === b.key)).map((b) => b.key);
  return { set, removedKeys };
}

/** The console's "Manage tags" page: a TagEditor in a form that saves only what changed. */
export function ManageTags({ tags, loading, op, onSave, cancelHref, tagLimit = 50 }: ManageTagsProps) {
  const user = (tags ?? []).filter((t) => !t.key.startsWith("aws:"));
  const [edited, setEdited] = useState<TagEditorProps.Tag[]>([]);

  useEffect(() => {
    setEdited(user.map((t) => ({ ...t, existing: true })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags]);

  const { set, removedKeys } = diff(user, edited);
  const dirty = set.length > 0 || removedKeys.length > 0;

  return (
    <CreateForm title="Manage tags" mode="edit" op={op} dirty={dirty} cancelHref={cancelHref} onSubmit={() => onSave(set, removedKeys)}>
      <Container
        header={
          <Header
            variant="h2"
            description="A tag is a label that you assign to an AWS resource. Each tag consists of a key and an optional value. You can use tags to search and filter your resources."
          >
            Tags
          </Header>
        }
      >
        <TagEditor
          tags={edited}
          onChange={({ detail }) => setEdited([...detail.tags])}
          loading={loading}
          tagLimit={tagLimit}
          i18nStrings={{
            tagLimit: (available) => `You can add up to ${available} more tag${available === 1 ? "" : "s"}.`,
          }}
        />
      </Container>
    </CreateForm>
  );
}
