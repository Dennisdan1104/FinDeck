/**
 * Session-mode UI plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. Mode behavior itself (the /mode command, the mode projection,
 * the flow_step tool, the flow prompt section) is owned by
 * `@deepseek-ai/dsh-mode`, composed independently on the host roster.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
