---
name: code-ui
description: How to write UI code in apps/web — component reuse, spacing ownership (padding in, margin out), the four states, accessibility, user-facing messages, the type ramp, touch targets, and layout that does not shift or overflow, plus the six-category token layer (colour, type, radius, elevation, motion, density) this project's theme is wired from. Use whenever building or changing any component, page, or form. Invoked from the web skill; it never commits.
---

# code-ui — writing UI in apps/web

Two kinds of rules live here, and the difference matters because this repo is meant to be
forked as a scaffold:

- **Principles** — hold for any app. Keep them.
- **Current wiring** — how _this_ project happens to be set up. Expected to be replaced.
  Each one names what enforces it, so you can change both together.

Where files live, codegen, and the data boundary are in the `web` skill.

---

# Principles

## Reuse before you build

- Check what already exists before writing a component.
- Compose around a component rather than fighting it. `CardHeader` switches to
  `grid-cols-[1fr_auto]` when it contains a `CardAction`, so put a header control in that
  slot instead of adding flex utilities.
- Read a component before adding classes to it — `Input` already styles `aria-invalid`.
- **Don't re-add padding or a border a component already has.** `CardFooter` carries
  `border-t p-(--card-spacing)`; a wrapper adding `border-t` and `pt-6` doubled the top
  padding to 41px. If a first child looks like it has a stray top margin, check the
  parent's padding before adding a negative margin.

## Don't pick a font size

A size is a **role**, not a judgement made per line. The roles are heading levels, lede,
body, meta, label; the app names each one once, and a component's job is to say which role
its text is, not how many pixels it should be.

- **Body is the default, and the default is written by writing nothing.** `<html>` is 16px,
  so a paragraph with no size class is already right. `text-sm` on a paragraph is a
  _decision to demote it_ below the reading size, and it needs a reason — dense controls,
  a table cell, form help, a caption. "It looked fine" is not one.
- **The component library has already picked, and it picked the dense size.** shadcn ships
  `text-sm` on `Card`, `Table`, `Button` and `Label`, so every paragraph inside a card is
  14px until the call site says otherwise. That inheritance is invisible in the JSX: the
  paragraph has no class, and it still isn't body size. **A card that holds reading copy
  carries the reading size itself.**
- **Keep a step between body and meta.** They are the two roles carrying the most words on
  a page; land them on the same size and every paragraph reads as a caption.
- **Muted is a role, not a shade.** `text-muted-foreground` marks text that _qualifies_
  content — a caption, a term, a state, a timestamp. It is never the content itself. An
  article body in the muted token reads as small and provisional at any size.
- The symptom of all four is one complaint — "the font looks small" — and the cause is
  usually that nobody chose. Grep the ratio: hundreds of `text-sm` against almost no
  `text-base` means the library picked the reading size.

**The floors, measured across 100 landing pages and corroborated by a 20-site crawl.** These
are metrics rather than taste, so they hold whatever the design direction is:

| Role                         | Floor                                       | Where the field sits                                                     |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| Body, any screen             | **16px**                                    | 16px is 44% desktop and 72% mobile; 18px is the marketing default at 33% |
| Body on a phone              | **16px, never less**                        | below it iOS Safari zooms a focused field                                |
| Button label                 | 16px, 14px in dense UI                      | 16px 47%, 14px 31%                                                       |
| Nav and footer links         | 14px                                        | 51% and 62%                                                              |
| Legal and captions           | 12px                                        | 49%                                                                      |
| Tap target                   | **44px on a phone**, 36–40px with a pointer | 44px minimum in 82%, per WCAG 2.5.5 and Apple HIG                        |
| Interactive target, any size | **24 × 24px**                               | WCAG 2.5.8 AA. Inline links in a sentence are exempt                     |

- **A size that changes with the screen is a token, not two classes at a call site.** Body
  and its lede are the only rows that move; declare them once and let the surface and the
  breakpoint resolve them, or the responsive pair gets written 40 times and drifts.
- **A control does not grow with the prose around it.** When body opens up on a reading
  surface, button labels stay put — a button that scales with the paragraph beside it has
  stopped being a button.

## Ink belongs to the ground, not to the app

`--foreground` and `--muted-foreground` are measured against `--background` and against
nothing else. The moment type sits on a different ground — a coloured band, a filled
header, an inverted panel — the page's ink is a claim nobody checked.

**The failure mode is invisibility, not dimness.** The muted role is chosen to sit a
readable distance _below_ the page ink on the page ground, which usually means the middle
of the lightness range — and a saturated brand colour is usually the middle of the
lightness range too. In this app `--muted-foreground` on `--primary` measures **1.05:1**:
not low contrast, the _same lightness as the ground_. It renders as a blank strip. Nothing
about the JSX looks wrong, and the diff that causes it is a component moving up the page.

- **A component that can stand on two grounds takes one prop naming the ground, not colour
  classes at the call site.** Same argument as tokens one property over: `tone="field"` is
  a job, `text-white/80` is a value, and a screen that has to write the second is a screen
  that can get it wrong. The prop is also where the _reason_ is documented once instead of
  in every call site's comment.
- **A registry component assumes the page ground, and is right to.** `components/ui` is a
  checkout: shadcn's `BreadcrumbList` sets `text-muted-foreground` and `BreadcrumbPage`
  sets `text-foreground` because that is the only ground it knows about. Don't patch the
  registry — the caller that moved it onto a coloured ground is what has to say so.
- **Most coloured grounds can only carry one ink.** Check before designing a two-step ramp
  on one: a mid-tone ground leaves so little headroom that its own primary ink may only
  reach ~5:1, and there is no room for a second step that still clears 4.5:1. When that is
  the case, recede by **size, weight or position** — those are unbounded and cost nothing.
- **Never recede by opacity on a coloured ground.** An alpha resolves against whatever is
  behind it, and light and dark put opposite inks on opposite grounds: here
  `primary-foreground` at 85% is 4.90:1 in light and 3.81:1 in dark. One alpha cannot serve
  both schemes, so the value that looked right in the scheme you had open is a failure in
  the other. A weight or a size serves both.
- **Emphasis is allowed to switch mechanism between grounds; hierarchy is not.** On paper
  the current breadcrumb is the darker of two inks, on the field it is the heavier of two
  weights. Same rank, different lever, because only one lever was available.
- **A hover that darkens has nowhere to go on a dark-on-light ground.** Re-check every
  interactive state, not just the resting one — swap the affordance to an underline where
  the colour move is unavailable.

Every one of those numbers belongs in a test, not a comment — see _Contrast claims decay
silently_ under the token layer.

## An element that belongs to a block is rendered by that block

If two elements always appear together and the second explains the first, one component
renders both. Passing them as siblings makes the relationship the _call site's_ problem,
and every call site solves it again.

The tell is arithmetic: this app's breadcrumb sat beside its page heading on ten screens
and those screens had chosen three different gaps between them (`gap-8`, `gap-6`,
`gap-4`). Nobody decided that; it is what "no owner" looks like from the outside.

The cost is not only inconsistency. A free-floating element can be placed in the wrong
_container_ — here one screen left the trail outside a full-bleed region, which put a band
of a third background between the masthead and the page's opening colour, and stopped the
region's own negative-margin pull from firing. Folding it in fixed the spacing on nine
screens and a layout defect on the tenth as the same edit.

- **Enforce it by not exporting the inner component.** A rule a page cannot break needs no
  lint rule reminding it not to.
- **Type the pair as a pair.** When neither half is meaningful alone, a union
  (`{ a?: undefined; b?: undefined } | { a: A; b: B }`) makes passing one without the other
  a compile error instead of a runtime shrug.
- **Keep the second value separate when it is genuinely different information.** Don't
  derive the breadcrumb's current page from the title because they match on six screens —
  on the other four they say different things, and the derivation would be a silent lie.

## A component owns its padding, never the space around it

A component styles its inside. The space _between_ it and its siblings belongs to whatever
is arranging them, expressed as `gap` on that container — not as margin on the child, and
not as an empty element wedged between them.

The reason is that a component cannot see its context. Any margin it declares is a guess
about a neighbour it does not know it has, and the guess is wrong in the next layout that
uses it. Margin then behaves worse than it looks: adjacent vertical margins collapse, so
two 16px margins produce 16px rather than 32 — until a parent grows a border or padding,
at which point they stop collapsing and it is 32 again, with nothing in either component
having changed. `gap` never collapses, and never applies before the first child or after
the last, so there is nothing left over to cancel.

**The way to tell whether a codebase holds this rule is to count the code that exists only
to take margins back off.** Here that count is near zero: 429 uses of `gap`/`space-y`
across `components/` and `app/`, against ten margin utilities in all of `components/ui/`,
six of which are negative bleeds (`-mx-4 -mb-4` on a dialog footer) cancelling padding the
component can see on a parent it is defined against. The four strays are the smell in
miniature — `TableCaption` ships `mt-4`, a declared distance from an element it has never
seen, and `alert.tsx` carries `[&_p:not(:last-child)]:mb-4`, which is margin on every
paragraph plus a selector to remove it from the last one. Both are a `gap` on the container
written the long way, and as a `gap` neither needs its exception.

The sibling `ai-workshop` slide shell is the same code with the rule dropped, and shows
what it costs. Components there own their margins — `Card` ships `mb-3`, every `<p>` gets
`margin-bottom: 10px` — so the containers have to undo them: three `:last-child` reset
blocks across two stylesheets, one of them a three-level positional chain
(`> :last-child > :last-child > :last-child`) followed by a second rule that re-targets
`.mb-3` by class because a positional chain cannot reach every card in a flex row. Call
sites then cancel whatever survived: 76 inline `marginBottom: 0`, 9 per-slide `<style>`
overrides, and 98 spacer elements. Roughly 180 pieces of code whose entire job is to undo
the margins the components insisted on.

**The bug it eventually caused is the part worth remembering.** One of those resets,
`p:last-child { margin-bottom: 0 }`, is a descendant selector, so it fires at any depth,
not just on the block that ends the page. A title component rendering
`<div><h2/><p/></div>` has its subtitle matched as `p:last-child` of its own wrapper, and
the space under the title is deleted — on 63 of the 69 slides using that component, from
the day it was written, with no author having typed a zero anywhere. A reset written for
one container reached into another and silently removed a gap. Under a `gap` there is no
reset to reach anywhere.

- **A spacer element is the same mistake moved outward.** An empty sibling holding space
  is markup that means nothing: easy to double, easy to strand when the element beside it
  renders conditionally, invisible in review, and silently wrong after a reorder. If two
  things need space between them, say it once on the parent that already knows about both.
- **Padding is genuinely the component's own business.** A card's inner padding, a
  button's, a dialog's — those describe the inside and travel correctly wherever the
  component lands. The line is _padding in, margin out_.
- **Non-uniform rhythm is a grouping problem, not a margin problem.** When one gap in a
  column has to be tighter than the rest, wrap that pair in its own container with its own
  `gap`. It reads as _these two belong together_, which is the thing you actually meant; a
  one-off margin only says _this one is different_.
- **Flowing rich text is the container's rhythm, not the component's.** A prose wrapper may
  space its own `<p>` and `<ul>` children, because it owns them and knows what they are.
  That is this same rule one level down — the owner sets the spacing — and where the
  wrapper is a flex column it still wants `gap` rather than margins plus a last-child
  exception.
- **Keep deliberate negative margins, and keep them next to what they undo.** `-mx-4` on a
  footer inside a `p-4` dialog is not a guess about a neighbour; it is a component
  cancelling padding it can see on a parent it is defined against. That is legible as long
  as the two numbers stay in the same file.

## A fixed height must fit its own line box

A pill, a chip, a badge, a compact button — anything with a hard height and a single line of
text — is three numbers that have to agree: the height, the vertical padding and border, and
the **line box** the type role brings. Get it wrong and the line box is taller than the
content box meant to hold it, `overflow-hidden` clips it, and what survives sits off-centre.

Do the arithmetic rather than trusting it: this app's badge was `h-5` (20px) less 2px of
border and 4px of padding — a 14px content box — holding a 12px label at 1.4 leading, a
16.8px line box. Three pixels too tall, and the residue landed 2.39px below the padding top
against 0.61px above the bottom. Collapse the line box to the em box (`leading-none`) or
raise the height; don't leave them disagreeing.

**The reason it gets reported as one component's bug is worth knowing.** Every badge rode
high identically, but only "Cancelled" was reported: a label with a descender fills the
space the bias opens up and a label without one does not, and a filled pill has a crisp
enough edge to measure against by eye where a pale one does not. So:

- **"Only X is broken, not Y" is usually one shared defect plus something masking it in Y.**
  When two instances of the same component differ, measure _both_ before theorising — if
  the numbers come back identical, the difference is in the content or the ground, and the
  fix belongs in the shared base rather than at either call site.
- A single line of prose leading inside a fixed-height control is the recurring version of
  this. The type role is right about paragraphs and wrong about pills.

## Cover all four states

Every async surface needs all four. Missing one is the usual UI bug.

| State   | Rule                                                           |
| ------- | -------------------------------------------------------------- |
| Pending | Render something. `authClient.useSession()` gives `isPending`. |
| Empty   | Say what empty means, not a blank area.                        |
| Error   | Show it where it belongs, never a raw error string.            |
| Success | Confirm it. Don't leave the user guessing.                     |

**A skeleton is a promise about the shape of the page, so it moves when the page does.** A
`loading.tsx` mirroring the _previous_ layout is worse than none: it draws the old
arrangement for the length of the fetch and then jumps to the new one, which animates the
change instead of hiding it. Moving an element between regions is exactly the edit that
leaves one behind — the page compiles, the tests pass, and the only symptom is a band of
colour appearing and vanishing on every navigation. **Whenever an element moves between
containers, grep the route's `loading.tsx` in the same edit**, and give the skeleton the new
parent's ground too — a placeholder in the page's grey on a coloured field is the same
ink-belongs-to-the-ground mistake one layer down.

### A third-party embed's arrival is your pending state

`loading.tsx` and Suspense cover the _server_ render. They are gone by the time a client
component hydrates, so a widget a vendor SDK mounts imperatively — a payment iframe, a map, a
captcha, a video player — leaves a window nothing draws: the script still has to be fetched,
evaluated, and given its config. Measured on this app's checkout that was ~200ms on a warm
cache and ~1.6s cold, and the payment card sat collapsed to its own padding at 32px before
jumping to ~1090px.

- **Most vendors cover their own internal load.** Stripe's iframe draws its own skeleton once
  it exists. What you owe is the window _before_ it exists — so hand over the moment the
  vendor is in the layout, not when it finishes.
- **Draw the same placeholder the route drew.** The two run back to back, so they are one
  component imported by both `loading.tsx` and the client component. Two different fake
  layouts in a row reads as the page changing its mind twice before it says anything.
- **Size it to the widget's observed initial height** so the handover doesn't jump. Measure
  that height; don't guess it. Draw the widget's genre — a card form is labelled fields and a
  pay button — not a redraw of the vendor's internals, which are theirs to change.
- **Read the arrival off the layout when the SDK reports nothing.** No `onReady`, no status
  callback: the slot simply has no height until the widget is in it.

  ```tsx
  const check = () => {
    if (node.getBoundingClientRect().height > 0) setMounted(true);
  };
  check();
  new ResizeObserver(check).observe(node);
  ```

  **Stack the two layers in one grid cell and add `items-start`.** A stretched grid item is as
  tall as its row, the row is as tall as the placeholder beside it, so the empty slot measures
  the placeholder's own height and reports the widget arrived before the script was fetched.
  That bug passes every hand test — the widget does arrive — and shows only on the slow
  connection nobody tried.

- **A placeholder that can never resolve needs a way out.** If the widget never comes, say so
  after a timeout, _beside_ the placeholder rather than instead of it: tearing down a widget
  that was one second away is worse than the wait.

## Accessibility

- Every input has a `<Label htmlFor>` matching its `id`.
- An icon-only button needs `aria-label` (see `ModeToggle`).
- An invalid input gets `aria-invalid` plus `aria-describedby` pointing at its message.
- Errors are `role="alert"`; confirmations are `role="status"`. Check what the component
  already sets — shadcn's `Alert` hardcodes `role="alert"` on its root, so a confirmation
  has to override it (`<Alert role="status">`) or it interrupts a screen reader.

## Never show a raw error

**Don't** render a server or library error string directly.

```tsx
setError(failed.message); // ✗ shows "[body.email] Invalid email address; ..."
```

**Do** map the error `code` to your own text, and log anything unmapped.

```tsx
const known = failed.code ? SERVER_ERRORS[failed.code] : undefined;
if (!known) console.error("Unmapped auth error", failed);
setErrors(known ?? { form: "Something went wrong. Try again." });
```

- **Use the same message for "no such user" and "wrong password."** Different messages let
  anyone test which emails have accounts.
- **Don't restate a rule the server owns.** Say "That password is too short", not "must be
  8 characters" — the real minimum lives in server config and will drift.

## Put a message where it belongs

**Don't** keep one error string with one slot. Every message lands in the wrong place
because there is no right place.

**Do** model errors by location:

```tsx
type Errors = { email?: string; password?: string; form?: string };
```

- Field errors go under that field. `form` is only for errors about the whole attempt:
  wrong credentials, unverified address, network failure.
- Clear a field's error when that field is edited, or it stays red while the user fixes it.
- Check blank and malformed input in the browser so there's no round trip. Let the server
  own length, uniqueness, and credentials; the client check is convenience only.

## A link is a promise of somewhere to go

A navigation costs the reader their place. Spend it on something they cannot get where
they already are.

**Don't** send a reader to a screen whose whole message is that there is nothing to do
there — a row that is expired, locked, cancelled or not yet open, linking to a detail
screen that says one sentence and offers no control.

**Do** say it in the row, in the cell where its action would have been. Two rules make
that land:

- **Say nothing the row already said.** A status of `Cancelled` beside the words "this is
  cancelled" is one fact charged twice. The line earns its place only when it carries
  something the status cannot — most often _why_, or _when it changes_.
- **A status word doing two jobs is the bug underneath.** If one label covers both "closed
  forever" and "not open yet", no amount of copy in the destination fixes the list; the row
  has to distinguish them, because the list is where the choice is made.

The same test applies to whole screens. Before giving a route a page, subtract everything
the screen that links to it already showed. If what is left is a couple of facts and one
control, it is a side-step, and it belongs in a dialog over the screen it came from — with
the route kept for the entries that have no screen behind them (a pasted link, a bookmark,
a search result, a refresh, no JS). Write the decision once, in a component both surfaces
render, or the two drift the first time someone fixes the copy on the one they were
looking at.

## Don't move the layout

Anything that appears resizes the container and moves every control below it — including
the button the user is about to click.

**Do** render the element always, and reserve its space:

```tsx
<p
  id="email-error"
  role="alert"
  className="text-destructive min-h-[1lh] text-sm"
>
  {errors.email}
</p>
```

`min-h-[1lh]` is exactly one line of text, so the gap follows the font size instead of a
fixed pixel value.

- **Component libraries generally don't do this for you.** Base UI's `Field.Error` renders
  in flow; shadcn's `FieldError` returns `null` when empty. Both shift.
- **Reserving one line only works if the text fits one line.** That's why the messages are
  short. A wrapped message still moves the layout.
- **Pair the slot with its control, don't let it sit in the gap flow.** A reserved line
  that is its own grid item costs its height _plus_ the container gap, on an empty form,
  forever. Wrap input and message together at zero gap.
- Applies to anything conditional: badges, hints, counters, icons.

**A hand-written line box does not follow the font size.** `min-h-[1lh]` does, which is
why it is the pattern above — but a skeleton bar (`h-5`), a spacer div, or any height
picked to match a line of type is a _copy_ of the ramp, and it goes stale the moment the
ramp moves. Change a size and every reserved height stated in the old one is now wrong on
every screen at once. Grep for them together.

**The exception: form-level messages.** Reserve space for _field_ messages, not for the
whole-form alert.

- An alert is a block, not a line — there is no single height to hold — and reserving one
  pads the form permanently for something most submits never show.
- **Put it at the top of the form**, not above the submit button. Every design system that
  has researched this puts the summary first: [GOV.UK](https://design-system.service.gov.uk/components/error-message/),
  [NHS](https://service-manual.nhs.uk/design-system/components/error-summary),
  [Scottish Government](https://designsystem.gov.scot/components/error-summary). Above the
  submit it lands next to the last field's reserved line, which is empty whenever the
  failure isn't about that field, so the alert arrives after a blank row and reads as
  detached.
- The counter-argument — that a top summary can scroll out of view, so an AJAX form should
  put it near the submit ([WebAIM](https://webaim.org/techniques/formvalidation/)) — only
  applies to forms tall enough to scroll. Check before assuming it applies.
- **A summary does not replace inline messages.** Errors only at the top force the user to
  recall which field each one meant instead of recognising it
  ([UX Movement](https://uxmovement.com/forms/the-best-place-for-error-messages-on-forms/)).

## A text link is a target too

Buttons get sized because they look like controls. A **link is as tall as its line box** —
20px at body size, 16px at label size — and nothing about it invites you to check. That is
why a codebase can fix every button and still fail the target criterion in thirty places:
footer lists, table cells, sortable column heads, breadcrumbs, a `<summary>`, a numeral in a
count column that is **7px wide**.

- **The bar is 24 × 24 CSS px** (WCAG 2.5.8, AA in 2.2). 44px is AAA and the phone
  convention, worth reaching where the layout has room.
- **The exception is inline, and only inline.** A link _inside a sentence_ is exempt,
  because its size is set by the line height of text the author does not control. A link
  alone in a table cell, a list item, or a definition value has no such excuse — it is
  standalone, and standalone is the common case in an interface.
- **Grow the target, not the ink.** Padding moves the layout, and these sit in ruled rows
  and table cells whose rhythm is the design. An overlay does not:

  ```
  relative after:absolute after:-inset-x-2.5 after:-inset-y-3 after:content-[''] sm:after:-inset-y-2
  ```

  The `::after` belongs to the anchor, so it _is_ the target: the hit area grows, the type
  does not move, and nothing reflows. Two vertical values because the room differs — a table
  cell is ~59px tall on a phone and ~38px with a pointer, so this takes 44px where a thumb
  aims and 36px where a cursor does, neither spilling into the row above.

- **An overlay cannot fix a narrow box.** A single digit is 7px wide; expanding it sideways
  runs into the next column before it reaches 24. Give the element a real minimum instead —
  `inline-block min-w-6 text-center`.

## Let a scroller shrink

A horizontally scrolling region — a wide table, a code block, an overflowing row — only
scrolls if it is allowed to be narrower than its content. **Every grid item, flex item and
`flex-1` panel between it and the page needs `min-w-0`**, because those default to
`min-width: auto`, which is their content's min-content width. Miss one and the scroller
sizes itself to the table and pushes the whole page wide instead; the `overflow-x-auto`
wrapper is still there, doing nothing.

- It is invisible at desktop width and only shows on a narrow screen, which is why it
  survives review. It is the usual cause of horizontal overflow at 320px, and almost never
  the type size — a bigger reading size just makes an existing one show sooner.
- **Fix it at the ancestor, not the leaf.** `min-w-0` on the table's own wrapper does
  nothing while the section above it still refuses to shrink.
- Measure it: `documentElement.scrollWidth - clientWidth` at 320px. It is 0 or it is a bug.

**The opposite bug is a scrollbar on a region whose content fits**, and the cause is almost
never the content. An absolutely positioned box contributes to its scrolling ancestor's
**scrollable overflow** even though it contributes nothing to layout — so an overlay that
exists purely to enlarge a hit area is, to the scroll container, content. This app's link
overlay reached 10px past its anchor, a table cell has 8px of padding, and the link in the
last column therefore put **2px** past the scroller's edge: a full-width scrollbar and the
15px of height it occupies, produced by a pseudo-element that renders nothing.

- **Never tune the overlay against the cell's padding.** Making the two numbers match fixes
  today's table and breaks on the first right-aligned column that drops its padding. Grow
  the overlay only on the axis the container does not scroll, and put any size the criterion
  actually needs into **layout** — a `min-w-6` on the element, which a scroll container is
  right to count — rather than into a box that pretends not to exist.
- **Check what the overlay was buying first.** WCAG 2.5.8 wants 24 × 24: measure the
  elements, don't assume. Every link carrying this one was already ≥29.8px wide on its own
  text and only 20.3px tall, so the horizontal half met nothing and the vertical half met
  everything.
- The experiment is two lines, and it beats reading CSS. Inject
  `container *::after { content: none !important }`, re-read `scrollWidth`, remove it:
  if the excess goes to 0 and comes back, the overlays are the content.

## Reserve space from the role, not from its current size

A skeleton bar, a spacer, any height picked to match a line of type is a **copy** of the
ramp, and it is wrong the moment the ramp moves — on every screen at once, which is why it
is never caught on the page being edited.

**Write the height as the role instead.** `h-[1lh]` is the element's own line-height, so a
bar carrying the same class as the text it stands in for is exactly one line of that text,
at every breakpoint and every surface, permanently:

```tsx
<Skeleton className="text-reading h-[1lh] w-2/3" />   {/* one body line, 16px or 18px */}
<Skeleton className="text-lede h-[1lh] w-80" />       {/* one lede line */}
<Skeleton className="text-3xl sm:text-5xl h-[1lh] w-56" /> {/* the hero, both steps */}
```

Same idea as `min-h-[1lh]` on a reserved message slot, one step further: that one follows
the font size, and this one follows the role. Where a height genuinely cannot derive — a
button, a control — restate it in the same responsive pair the component uses, and expect
to revisit it when the component changes.

---

# Current wiring

Replaceable. Change the enforcement named alongside each.

## Components — vendored shadcn

`src/components/ui/` is a checkout of the shadcn registry, not code we write. `shadcn add`
overwrites it, so editing a file there is a fork you now maintain — either compose around
it or accept ownership deliberately.

Swap the component library and this section goes with it.

## The token layer — six categories, one file

The durable part is that **a component names a role and never a value**, so the look can
change in one place. Mature systems (Carbon, Primer, Polaris, Material 3) all tokenise the
same six categories, and the useful discipline is to answer all six — including the ones
you are refusing. "This direction has no elevation" is an answer; a missing elevation token
is a gap that gets filled by whoever reaches for `shadow-md` first.

| Category      | Where the value lives                                  | What a component writes                                    |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| **Colour**    | `theme.css`, both schemes                              | `bg-background`, `text-muted-foreground`                   |
| **Type**      | `theme.css` `--type-*`, `--weight-*`, `--*-tracking`   | `text-reading`, `font-strong`, `tracking-display`          |
| **Radius**    | `theme.css` `--radius`, steps derived in `globals.css` | `rounded-md`                                               |
| **Elevation** | `theme.css` `--elevation-flow` / `--elevation-overlay` | nothing in flow; `shadow-overlay` on a floating layer      |
| **Motion**    | `theme.css` `--motion-*`                               | `transition-colors` — the duration and easing are defaults |
| **Density**   | `theme.css` `--control-h*`, `--focus-ring-w`           | `CTA`, `FOCUS_RING`                                        |

`src/styles/theme.css` holds every value; `@theme inline` in `src/app/globals.css` maps
them onto Tailwind's namespaces. The names differ on each side on purpose — `--type-meta`
becomes `--text-meta` — because mapping a name to itself is a cycle.

**Three things this buys that a convention does not.**

- **Elevation becomes structural.** The in-flow shadow steps resolve to `none`, so a stray
  `shadow-sm` renders nothing, anywhere, including inside the registry. The rule "no shadow
  on anything in flow" stops depending on anyone remembering it.
- **Motion needs no call sites.** Tailwind reads `--default-transition-duration` and
  `--default-transition-timing-function`, so setting those two makes every `transition-*`
  in the app obey — the vendored components included — without one of them naming a
  duration.
- **A role is not a step.** `text-meta` and `text-sm` are the same 14px today and they are
  not the same decision: one says "this qualifies the content", the other says "small".
  Naming the step is how body copy gets quietly demoted.

**Enforced by** four things, and it needs all four:

1. `eslint.config.mjs` blocks raw palette colours, raw type steps (`text-sm`, `font-medium`,
   `tracking-tight`) and raw elevation steps in `className`, outside `src/components/ui`.
2. `styles/theme.test.ts` asserts every mapped token is declared, every colour has a dark
   value, and **every type role is declared, mapped, and paired with a line height** — a
   role that is declared but unmapped renders nothing at all, silently.
3. `styles/contrast.test.ts` recomputes every ink-on-ground pair from the tokens. See below.
4. `lib/utils.test.ts` asserts a role survives `cn()`. See the trap after that.

### Contrast claims decay silently

A ratio written in a comment is a claim about a value in **another file**. Warm the brand
colour half a step of lightness and every "5.59:1" in the codebase becomes false — with no
failing test, no visual break big enough to notice, and the people it fails least able to
report it. Palette edits are exactly the diffs where a reviewer checks the swatch and not
the twenty components standing on it.

So parse the theme and compute the ratios in a test. `styles/contrast.test.ts` reads the
oklch triples out of `theme.css`, converts through linear-light sRGB to WCAG relative
luminance, and runs two tables **in both schemes**:

- **Required** — ink, ground, floor, and _which component depends on it_. 4.5:1 for body
  (WCAG 1.4.3); 3:1 for large text and for a control's own boundary against what surrounds
  it (1.4.11). Name the component: a floor with no dependant is untraceable when it breaks.
- **Forbidden** — pairs a component must never reach for, held _below_ a ceiling. These are
  page-ground inks on a coloured ground: the default a component gets by doing nothing.
  Asserting the trap stays a trap is what keeps a `tone` prop honest rather than
  superstitious.

Two things to get right:

- **Only assert a ceiling where a component would land on the pair by doing nothing.** A
  pair nothing reaches for and that sits in the grey zone (say 3.7:1 — too low for body,
  not low enough to call unusable) will fail an "unusable" assertion for a reason that is
  not a defect. Writing the table is itself the audit: check whether anything renders the
  pair before you forbid it.
- **Mutation-test it.** Nudge one token's lightness and confirm assertions fail in both
  directions — a floor _and_ a ceiling. A contrast test that passes against any palette is
  worse than none, because it certifies.

### The `cn()` trap, which costs nothing to hit and everything to find

`cn()` is tailwind-merge, and it resolves conflicts **by class group**. Its built-in
`font-size` group knows exactly one literal — `text-base` — and every other `text-*` falls
through to `text-color`. So a custom role is read as a colour, and the colour class beside
it in the same `cn()` **deletes it**. No error. No warning. A table header that renders at
the inherited size and looks approximately right.

Register every custom role with `extendTailwindMerge` in `lib/utils.ts` — sizes under
`font-size`, weights under `font-weight`, families under `font-family` (or the two collide),
plus `tracking` and `shadow`. Adding a role to `theme.css` means adding it there too, and
the test is what says so.

This generalises past type: **any custom utility whose name shape collides with a built-in
group is at risk**, and the symptom is always the same — the class is missing from the
rendered DOM while the source looks correct. `element.className.includes(...)` is the check.

## Framework — Next App Router

- Default to a server component; add `"use client"` only for state, effects, or browser
  APIs.
- Don't render from a value that only exists after mount — it causes a hydration mismatch.
  `ModeToggle` shows its icons with `dark:hidden` / `dark:block` off the class rather than
  from `resolvedTheme`, which is `undefined` until the client mounts.
- A client-side mutation does not re-render a server component. Call `router.refresh()`, or
  server-read data stays stale.

---

# How to verify

1. **Measure, don't eyeball.** Record the container height and submit button `top` before
   and after the message appears. They must be identical.

   ```js
   const card = document.querySelector('[data-slot="card"]');
   const btn = [...document.querySelectorAll("button")].find(
     (b) => b.textContent.trim() === "Sign in",
   );
   ({
     h: card.getBoundingClientRect().height,
     y: btn.getBoundingClientRect().top,
   });
   ```

2. **Then measure what the empty state costs.** "Nothing moved" is only half the check —
   reserved space is paid on every render, including the ones with nothing to show. Measure
   the gaps in the pristine form, not just the stability of the errored one. Reserving
   naively here passed the shift check while adding 68px of dead space and a blank row
   between the last field and the alert.

   ```js
   const r = (s) => document.querySelector(s).getBoundingClientRect();
   ({
     inputToMessage: r("#email-error").top - r("#email").bottom, // want 0
     lastFieldToButton:
       r("[data-slot=card] button").top - r("#password").bottom,
   });
   ```

3. **Check both colour schemes.** A missing dark token only shows in dark mode.

   **If anything moved onto a different ground, read its computed colour rather than
   looking at it.** A washed-out ink and a correct one are hard to tell apart in a
   screenshot; an ink at the ground's own lightness is not visible at all, so the element
   looks _absent_ and reads as a layout question. Compare the two:

   ```js
   const el = document.querySelector('[data-slot="breadcrumb-link"]');
   ({
     ink: getComputedStyle(el).color,
     ground: getComputedStyle(el.closest("[data-bleed]")).backgroundColor,
   });
   ```

   Then add the pair to `styles/contrast.test.ts` so the next palette edit has to keep it.

4. **Check wrapping at the smallest screen**, not the one you have open. A 320px phone
   leaves the card 272px wide after `p-6`. Compare each message's rendered height against
   its `line-height`; anything taller wraps and must be shortened.

   Check overflow there too, and check it on **every** route rather than the one you
   changed — a shared component takes the whole app with it. Same-origin iframes make that
   one script instead of one navigation each:

   ```js
   const f = document.createElement("iframe");
   f.style.cssText =
     "width:320px;height:900px;position:fixed;left:-9999px;border:0";
   f.src = route;
   document.body.appendChild(f);
   await new Promise((r) => {
     f.onload = r;
     setTimeout(r, 9000);
   });
   const de = f.contentDocument.documentElement;
   ({ overflow: de.scrollWidth - de.clientWidth }); // want 0
   ```

   Add `de.classList.add("dark")` to sweep the other scheme in the same pass, and walk
   `body.querySelectorAll("*")` for the shallowest element whose `right` exceeds 320 — that
   is the box that needed `min-w-0`, not the one you would have guessed.

   **Read the inner scrollers in the same sweep, at full width as well as 320px.** The page
   not overflowing says nothing about the boxes inside it, and a scrollbar on a region whose
   content fits is a defect in the other direction:

   ```js
   [...d.querySelectorAll("*")]
     .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowX))
     .map((el) => ({
       cls: el.className,
       excess: el.scrollWidth - el.clientWidth,
     }));
   ```

   Any non-zero `excess` on a region that visibly fits is an overlay, not content.

   One caveat that costs real time: a tab in the background does not lay out panels that JS
   reveals, so measurements come back `0` and elements read as `display: none`. If widths
   are zero while a screenshot shows content, take the screenshot first to force the paint,
   then measure — don't start debugging the component.

5. **Delay the vendor's script to test an embed's pending state** — don't hope to catch a
   200ms window. An init script that holds back the injected tag makes it as long as you need:

   ```js
   const append = Node.prototype.appendChild;
   Node.prototype.appendChild = function (n) {
     if (n?.tagName === "SCRIPT" && n.src?.includes("js.stripe.com")) {
       setTimeout(() => append.call(this, n), 8000);
       return n;
     }
     return append.call(this, n);
   };
   ```

   Then sample the slot's height every 300ms across the handover. It must never collapse, and
   the step from placeholder to widget must be small — 648 → 652 here.

6. **Hit-test targets; do not measure them.** `getBoundingClientRect()` returns the
   element's own border box and an absolutely positioned `::after` is out of flow, so a
   rect shows **no change at all** after the hit area is added — and would show a false
   pass for any technique that moved the layout instead. Probe what actually takes the
   pointer:

   ```js
   el.scrollIntoView({ block: "center" }); // elementFromPoint is VIEWPORT-relative:
   const r = el.getBoundingClientRect(); // anything off-screen returns null, which
   const owns = (x, y) => {
     // reads as a failure and is not one
     const t = document.elementFromPoint(x, y);
     return !!t && (t === el || el.contains(t));
   };
   let up = 0;
   while (up < 30 && owns(r.left + r.width / 2, r.top - up - 1)) up++;
   ```

   Walk outward from each edge until the point stops resolving to the element; the sum is
   the real target. Run it over `a[href], button, [role="button"], summary` on every route
   at 390px and at desktop, and count what comes back under 24px.

7. **Verify a class survived, not just that you wrote it.** Tailwind does not error on an
   unknown class and `cn()` deletes conflicting ones, so a themed utility can be absent
   from the DOM while the source reads correctly. Two checks, and the first is the one that
   catches the silent case:

   ```js
   el.closest('[class*="thead_th"]').className.includes(
     "[&_thead_th]:text-label",
   ); // survived cn()?
   getComputedStyle(el).fontSize; // resolved to a value?
   ```

   A `var()` that resolves to nothing makes the whole declaration invalid and the property
   falls back to inherited — which is why "it looks about right" is not evidence.

8. **Watch out for Chrome autofill.** It refills the form after a reload without React
   seeing it, so the DOM shows text while state is empty. Clear the fields and submit in
   one script. Never submit real saved credentials to test a failure path.

## Return

Return to the `web` skill. **Do not commit** — the slice commits, not the layer.
