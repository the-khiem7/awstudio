// Adapted from cloudscape-design/demos (MIT-0): pages/form-unsaved-changes.

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useEffect, useRef, useState } from "react";
import { navigate } from "../shell/router";

/**
 * Guards a form with unsaved changes: closing the window asks through the WebView, and leaving the
 * route asks through the console's "Leave page" modal. `leave(target)` is the form's Cancel.
 */
export function useUnsavedChanges(dirty: boolean) {
  const [pending, setPending] = useState<string | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const allowed = useRef<string | null>(null);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // A link elsewhere on the page changes the hash: put the route back and ask first. The listener
  // runs in the capture phase and stops the event, so the router never renders the other route.
  useEffect(() => {
    const here = window.location.hash;
    const onHashChange = (e: HashChangeEvent) => {
      const target = new URL(e.newURL).hash;
      if (!dirtyRef.current || target === here || allowed.current === target) return;
      e.stopImmediatePropagation();
      history.replaceState(null, "", here);
      setPending(target);
    };
    window.addEventListener("hashchange", onHashChange, { capture: true });
    return () => window.removeEventListener("hashchange", onHashChange, { capture: true });
  }, []);

  const go = (target: string) => {
    allowed.current = target;
    navigate(target);
  };

  const leave = (target: string) => (dirtyRef.current ? setPending(target) : go(target));

  const modal = (
    <Modal
      visible={pending !== null}
      header="Leave page"
      closeAriaLabel="Close modal"
      onDismiss={() => setPending(null)}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const target = pending;
                setPending(null);
                if (target) go(target);
              }}
            >
              Leave
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Alert type="warning" statusIconAriaLabel="Warning">
        Are you sure that you want to leave the current page? The changes that you made won't be saved.
      </Alert>
    </Modal>
  );

  /** Call after a successful save, so the navigation that follows is not held back. */
  const release = () => {
    dirtyRef.current = false;
  };

  return { leave, modal, release, go };
}
