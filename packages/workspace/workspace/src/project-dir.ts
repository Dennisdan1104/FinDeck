/**
 * Project directory layout of one Workspace: the resolved root a project keeps
 * its `memory/`, `presets/`, and `automations/` resources under. The default is
 * derived from the harness home and the Workspace id; a Workspace stores a
 * custom override only, so the derived spelling has no stored copy to diverge
 * from.
 * @module @deepseek-ai/dsh-workspace/src/project-dir
 */

import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { containsPath } from './paths.ts'
import type { Workspace, WorkspaceId } from './types.ts'

/** Directory under the harness home holding every default project directory. */
export const PROJECTS_DIR_NAME = 'projects'

/** Managed subdirectories every project directory carries. */
export type ProjectSubdirectory = 'memory' | 'presets' | 'automations'

/** Whether each managed subdirectory exists inside one resolved project directory. */
export type ProjectSubdirectories = Readonly<Record<ProjectSubdirectory, boolean>>

/** One resolved project directory and the state of its managed subdirectories. */
export interface ProjectDirState {
  /** Resolved absolute project directory: the custom override when set, otherwise the default. */
  readonly projectDir: string
  /** Whether each managed subdirectory exists. */
  readonly subdirectories: ProjectSubdirectories
}

/**
 * The default project directory of one Workspace: `<home>/projects/<workspace-id>`.
 * @param id - Workspace whose project directory is named.
 * @param home - Harness home; defaults to the process's resolved home.
 * @returns the absolute default project directory.
 */
export function defaultProjectDir(id: WorkspaceId, home: string = resolveDshHome()): string {
  return join(home, PROJECTS_DIR_NAME, id)
}

/**
 * Resolve one Workspace's project directory: its custom path when set,
 * otherwise {@link defaultProjectDir}. Nothing is created or written.
 * @param workspace - Workspace carrying an optional custom project directory.
 * @param home - Harness home used for the default; defaults to the process's resolved home.
 * @returns the absolute project directory.
 */
export function resolveProjectDir(workspace: Workspace, home: string = resolveDshHome()): string {
  return workspace.projectDir ?? defaultProjectDir(workspace.id, home)
}

/**
 * Absolute `memory/` directory of one resolved project directory.
 * @param projectDir - Resolved project directory.
 * @returns the `memory/` path under it.
 */
export function projectMemoryDir(projectDir: string): string {
  return join(projectDir, 'memory')
}

/**
 * Absolute `presets/` directory of one resolved project directory.
 * @param projectDir - Resolved project directory.
 * @returns the `presets/` path under it.
 */
export function projectPresetsDir(projectDir: string): string {
  return join(projectDir, 'presets')
}

/**
 * The project `presets/` directory of the workspace whose registered path
 * contains `path`: the project-scoped preset root one working directory is
 * entitled to see. Containment is by path segment over canonical spellings,
 * and the deepest registered path wins when workspaces nest, so a path inside
 * one workspace can never reach a sibling's presets. Nothing is created and no
 * record is written: an absent project simply supplies no presets, which reads
 * the same as an empty root.
 * @param workspaces - Registered workspaces, in any order.
 * @param path - Canonical absolute directory path, typically a session's working directory.
 * @param platform - Host platform; injectable for deterministic path tests.
 * @returns the absolute `presets/` path, or undefined when no workspace contains `path`.
 */
export function projectPresetsDirOf(
  workspaces: Iterable<Workspace>,
  path: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  let found: { readonly path: string; readonly dir: string } | undefined
  for (const workspace of workspaces) {
    if (!containsPath(workspace.path, path, platform)) continue
    if (found !== undefined && workspace.path.length <= found.path.length) continue
    found = { path: workspace.path, dir: projectPresetsDir(resolveProjectDir(workspace)) }
  }
  return found?.dir
}

/**
 * Absolute `automations/` directory of one resolved project directory.
 * @param projectDir - Resolved project directory.
 * @returns the `automations/` path under it.
 */
export function projectAutomationsDir(projectDir: string): string {
  return join(projectDir, 'automations')
}

/**
 * Materialize one project directory: the root plus its `memory/`, `presets/`,
 * and `automations/` subdirectories. Existing directories are left untouched,
 * and the reported subdirectory state is observed after creation rather than
 * assumed from it.
 * @param projectDir - Absolute project directory to create.
 * @returns the resolved root and the observed existence of each subdirectory.
 */
export async function materializeProjectDir(projectDir: string): Promise<ProjectDirState> {
  await mkdir(projectDir, { recursive: true })
  const [memory, presets, automations] = await Promise.all([
    ensureDirectory(projectMemoryDir(projectDir)),
    ensureDirectory(projectPresetsDir(projectDir)),
    ensureDirectory(projectAutomationsDir(projectDir)),
  ])
  return { projectDir, subdirectories: { memory, presets, automations } }
}

/** Create one directory with its parents and report whether it now exists. */
async function ensureDirectory(path: string): Promise<boolean> {
  await mkdir(path, { recursive: true })
  try {
    return (await stat(path)).isDirectory()
  } catch {
    // Stat is the only probe after mkdir: absence, a parent replaced by a file,
    // and permission loss all mean the directory is not usable right now.
    return false
  }
}
