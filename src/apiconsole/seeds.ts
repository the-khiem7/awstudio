import { commands, type SeedScript_Deserialize, type SeedStep_Deserialize } from "../bindings";

/** Appends one call to a seed script, creating the script when it does not exist yet. */
export async function addSeedStep(name: string, step: SeedStep_Deserialize): Promise<number> {
  const existing = (await commands.seedList()).some((s) => s.name === name);
  const script: SeedScript_Deserialize = existing ? await commands.seedLoad(name) : { name, steps: [] };
  const next = { ...script, steps: [...script.steps, step] };
  await commands.seedSave(next);
  return next.steps.length;
}
