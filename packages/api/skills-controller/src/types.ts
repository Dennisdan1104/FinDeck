/**
 * Browser-safe vocabulary of the skill administration surface. These are
 * discovery facts, never skill bodies: the settings page shows what exists and
 * whether it is suppressed, and never receives instruction text.
 *
 * @module @deepseek-ai/dsh-api-skills-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested name is not a valid kebab-case skill identifier. */
    'skills/invalid-name': { readonly name: string }
    /** The durable disable list refused the write, or this deployment mounts no settings provider to store it. */
    'skills/rejected': { readonly name?: string }
    /** No discovered or stored skill carries the requested name. */
    'skills/not-found': { readonly name: string }
    /** The target name or directory is already occupied. */
    'skills/conflict': { readonly name: string }
    /** The skill is owned by a read-only provider or root; only user skills directories are editable. */
    'skills/read-only': { readonly name: string }
    /** A filesystem or network operation behind the request failed. */
    'skills/io': { readonly path?: string }
  }
}

/**
 * One skill as the administration surface lists it, independent of any
 * Session. The winning candidate of the merged catalog supplies every field;
 * a skill two scopes both discover appears once.
 */
export interface SkillAdminEntry {
  /** Kebab-case skill name; the identity the disable list stores. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Discovery origin bucket of the winning candidate (e.g. `custom`, `user-dsh`, `bundled`). */
  readonly source: string
  /** Provider that owns the skill body. */
  readonly provider: string
  /** Directory the skill's relative resources resolve against, when the provider has one. */
  readonly directory?: string
  /** Whether model-facing catalogs and loaders advertise this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs advertise this skill. */
  readonly userInvocable: boolean
  /** Whether the durable disable list currently suppresses this skill. */
  readonly disabled: boolean
}

/**
 * One skill document as the editor loads it. `content` is the Markdown body
 * without frontmatter; `writable` marks a skill whose file lives under a user
 * skills root and may be updated or removed through this surface.
 */
export interface SkillDetail {
  readonly name: string
  readonly description: string
  /** Optional routing guidance; empty when the frontmatter omits it. */
  readonly whenToUse: string
  /** Markdown instruction body. */
  readonly content: string
  /** Discovery origin bucket of the winning candidate. */
  readonly source: string
  /** Provider that owns the skill body. */
  readonly provider: string
  /** Directory the skill's relative resources resolve against, when the provider has one. */
  readonly directory?: string
  /** Whether `update`/`remove` accept this skill. */
  readonly writable: boolean
  /** Whether the durable disable list currently suppresses this skill. */
  readonly disabled: boolean
}

/** The editor's create/update payload: frontmatter fields plus the Markdown body. */
export interface SkillSaveRequest {
  /** Kebab-case skill name; immutable identity on update. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional routing guidance stored as the `whenToUse` frontmatter field. */
  readonly whenToUse?: string
  /** Markdown instruction body. */
  readonly content: string
}

/** One importable skill found under another agent's skills root. */
export interface SkillExternalSkill {
  /** Skill name from its frontmatter (falling back to the entry name). */
  readonly name: string
  /** Frontmatter description; empty when the file cannot be parsed. */
  readonly description: string
  /** Absolute path of the skill directory or Markdown file. */
  readonly path: string
}

/** One scanned external agent skills root (only roots that exist are listed). */
export interface SkillExternalRoot {
  /** Display label of the source agent (e.g. `Claude Code`). */
  readonly label: string
  /** Absolute path of the scanned root. */
  readonly path: string
  /** Importable skills discovered directly under the root. */
  readonly skills: SkillExternalSkill[]
}

/** One curated gallery entry the page can install with one click. */
export interface SkillGalleryEntry {
  /** Stable gallery identity the install call echoes back. */
  readonly id: string
  /** Skill name the installed file declares. */
  readonly name: string
  /** What the skill does, in the gallery's own words. */
  readonly description: string
  /** Upstream project label (e.g. `obra/superpowers`). */
  readonly origin: string
  /** Upstream license label; the entry's `repoUrl` carries the full text. */
  readonly license: string
  /** Repository or documentation link for the entry. */
  readonly repoUrl: string
  /** Whether a skill of this name is already discovered. */
  readonly installed: boolean
}

/** The create-skill-from-sessions request: stored session ids to distill. */
export interface SkillForgeRequest {
  /** Stored session ids, in the order the user picked them. */
  readonly sessionIds: string[]
}

/**
 * The forge handoff: extracted transcripts on disk plus the seed prompt a
 * fresh session is opened with. The seed instructs that session's agent to
 * read the transcripts, interview the user, and write the new skill.
 */
export interface SkillForgeResult {
  /** Absolute directory the transcript extracts were written to. */
  readonly directory: string
  /** Absolute paths of the per-session transcript files, in request order. */
  readonly files: string[]
  /** The complete first prompt for the forge session. */
  readonly seed: string
  /**
   * Preset the fresh session is composed from, so the distillation runs in the
   * shipped skill-authoring work mode instead of the deployment default. The
   * Host owns it beside the seed: both are the handoff's own contract.
   */
  readonly agentPreset: string
}
