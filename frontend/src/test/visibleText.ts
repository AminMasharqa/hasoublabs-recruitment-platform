/**
 * The document's rendered text, without the contents of `<style>` and `<script>`.
 *
 * `document.body.textContent` also returns the CSS variables `MantineProvider`
 * injects into the body, so a check that a value never reaches the screen can fail
 * on a theme colour: `#242424` contains `42`. Use this for those checks.
 */
export function visibleBodyText(): string {
  const body = document.body.cloneNode(true) as HTMLElement
  body.querySelectorAll('style, script').forEach((element) => {
    element.remove()
  })
  return body.textContent ?? ''
}
