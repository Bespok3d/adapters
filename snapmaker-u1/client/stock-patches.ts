// Pure patchers for the two OEM files bespok3d modifies in place: the nginx site (so plugins can
// drop location blocks) and the S90lmd boot script (so control passes to S99bespok3d). Both are
// idempotent: already-patched content is returned unchanged.

export function patchNginx(content: string): string {
  const marker = 'bespok3d/etc/nginx/locations'
  if (content.includes(marker)) return content

  const includeLine = '    include /userdata/bespok3d/etc/nginx/locations/*.conf;\n'
  const stripped = content.trimEnd()
  if (!stripped.endsWith('}')) {
    throw new Error('Unexpected nginx config format: file does not end with "}"')
  }

  return stripped.slice(0, -1) + includeLine + '}\n'
}

export function patchS90lmd(content: string): string {
  const marker = 'S99bespok3d'
  if (content.includes(marker)) return content

  const lines = content.split('\n')
  if (!lines[0]?.startsWith('#!')) {
    throw new Error('Unexpected S90lmd format: file does not start with a shebang')
  }
  const hookLine = '[ -x /etc/init.d/S99bespok3d ] && exec /etc/init.d/S99bespok3d "$@"'
  lines.splice(1, 0, hookLine)

  return lines.join('\n')
}
