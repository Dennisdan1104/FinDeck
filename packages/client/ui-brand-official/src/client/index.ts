/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { OfficialBrandMark, OfficialBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar brand slots as one declaration-aware registration set. The
 * conversation hero keeps its declaring package's FinDeck mark, so no build
 * registers anything there.
 *
 * The `official` profile this gate tests no longer exists — FinDeck builds set
 * `DSH_CLIENT_BUILD_PROFILE=findeck` and mount no row for this package — so a
 * FinDeck client leaves the sidebar fallbacks in place. A deployment that
 * restores the DeepSeek identity re-adds both: its own profile value here and
 * a `dsh.client` row in its bundle's `cordis.patch.yml`.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
    }))
}
