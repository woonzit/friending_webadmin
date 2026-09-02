# Operator guide: colouring, landing/hero placements and mandatory verification

Audience: the Friending owner and administrators who change what the app looks
like per country, and who decide when verification becomes mandatory. No
engineering knowledge is assumed. The Hungarian twin of this document is
`operator-guide-appearance-and-mandatory-verification.hu.md`; both describe the
same screens.

Two consoles are covered:

1. **Appearance & placements** (`/appearance`) — live today. The landing
   screen, the Discover hero carousel and the light/dark accent palette, per
   App Store storefront or per geographic area.
2. **Verification → Scopes** — the ONE table that decides which verification
   method is mandatory, globally and per App Store storefront, and owns the
   Waiting Room text for each row. It appears for administrators whose Core
   account carries the method-console capability; there is no separate switch
   to ask for. Read the rollout rule at the end before you make a method
   mandatory anywhere.

Everything you change here is stored by Core, recorded in the audit trail with
your e-mail, and takes effect for members without an app update.

---

## 1. Appearance & placements

### 1.1 How the levels fit together

Four levels answer the question "what should this member see?", and the first
one that matches wins:

| Level | Matches | Typical use |
|---|---|---|
| Geo rule | The member is inside a city or map circle right now | A city campaign, a festival, a launch event |
| Store-country rule | The member's App Store storefront (where their Apple account buys) | A country-wide look |
| Global rule | Everyone | The permanent base look |
| Compiled defaults | Nothing configured | The brand colours shipped inside the app |

Two rules of thumb:

- **Blank means inherit, not empty.** A field you leave blank takes the value
  from the level below. You only fill in what actually differs.
- **Geo beats store country, which beats global.** Where two rules of the same
  kind overlap, the priority number you set decides; for two geo rules of equal
  priority the nearer centre wins, then the smaller radius, then the newer rule.

The rule list on the page is printed in exactly this resolution order, so
reading it top to bottom tells you what a member will get.

### 1.2 The global rule comes first

There is always exactly one global rule and it cannot be deleted. It supplies
the base that every override inherits from, so set it up properly before you
create anything else: the landing background, the hero carousel and both
palettes.

### 1.3 Creating a store-country rule

Use this when a whole country should look different — for example a different
landing image for the United States.

1. Press **New rule** and choose the **Store country** scope.
2. Pick the country. This is the **App Store storefront**, meaning the country
   of the member's Apple account — not their current location and not their
   phone number. A Hungarian tourist in New York still gets the Hungarian
   storefront rule.
3. Fill only the fields that differ from the global rule. Leave everything else
   blank so it keeps inheriting.
4. Set **Priority** if another store-country rule could cover the same country.
5. Leave the rule **inactive** while you are still assembling it.

### 1.4 Creating a geo rule (map picker and city search)

Use this when the member's *current position* should decide, for example a
campaign for people in Budapest this weekend.

1. Press **New rule** and choose the **Geo** scope.
2. Type a city into the search box and pick a result. The centre coordinates,
   a suggested radius, the label and the country are filled in for you. The
   search is answered by Core, not by the browser.
3. Fine-tune by dragging the marker on the map, or by typing coordinates
   directly. Set the **radius in kilometres** — the circle on the map is what
   members are matched against.
4. If the map does not appear, the console is running without a browser map
   key. This is not an error: the coordinate and radius fields alone define the
   rule exactly, and the map is only a convenience.

A member matches when their current location falls inside the circle, so a geo
rule can start and stop applying to the same person as they travel.

### 1.5 Event window and active state

- **Active** decides whether Core considers the rule at all. Keep a draft
  inactive until its media and copy are approved.
- **Start** and **end** are optional. Together they make an event window: the
  rule resolves only inside it, the start instant included and the end instant
  excluded. Enter them in your local time; the editor shows the UTC equivalent
  underneath, which is what the server stores.
- A rule outside its window is simply skipped and the next level applies. It is
  not an error state and needs no cleanup after the event.

### 1.6 The landing screen

Fields, each inheriting on its own when left blank:

- **Background**: an image or a video. A video may have a **poster** — the
  still frame shown while the video loads. The poster is only used over a video
  background; over an image background it is ignored.
- **Title**: either text in both languages, or an image title (a logo-style
  picture). An image title without its picture is refused when you save,
  instead of shipping a broken image to members.
- **Description**: text in both languages.

Always fill both English and Hungarian where the field is text. English is the
fallback: a member whose phone is set to any third language sees the English
text.

Use the phone preview beside the editor to confirm the *resolved* result — that
is, your rule stacked on top of what it inherits.

### 1.7 The Discover hero carousel

Each rule either **inherits** the carousel or **replaces** it with its own
ordered list of cards. Choose Replace only when this audience should genuinely
see a different carousel; there is no partial merge.

- Cards are images or videos with bilingual copy and optional typography.
- The order you set is the order members swipe through.
- An **empty replacement hides the carousel** for the matching members. That is
  a legitimate choice, but make sure it is deliberate.

### 1.8 Light and dark palette

Five colour roles per mode:

| Role | Where it shows |
|---|---|
| Main accent | Primary buttons, active tab, highlights |
| Pressed | The accent while a button is held down |
| Faint background | Tinted backgrounds behind accented blocks |
| Text on accent | Labels printed on an accent-coloured surface |
| Inactive | Disabled controls and inactive tabs |

Each role is either **inherited** or set to a `#RRGGBB` colour on this rule.
Untick *Inherit* only for the roles this rule should change. Both modes ship to
the app, so check the light and the dark preview before saving — and above all
keep **text on accent** readable against the accent in both modes.

### 1.9 Preview for a test location

Before activating anything, use the preview panel. Enter a storefront and
coordinates the way a real device would send them, or an IP address, and Core
answers with exactly what the app would receive: which rule matched, the
resolved landing, the hero list and the palette swatches.

This is computed by Core, not by the browser, so it reflects the rules stored at
the moment you run it. It is the honest final check — trust it over the editor
previews.

### 1.10 Saving: conflicts and uncertain results

Every save carries the revision number you loaded, so two administrators can
never silently overwrite each other.

- **Success**: the confirmation names the rule and its new revision.
- **Conflict (HTTP 409)**: somebody else changed that rule after you opened it.
  Your draft was *not* written. Reload the rule, apply your change again on the
  fresh content, and save.
- **Uncertain result** (timeout, lost connection): the answer never arrived, so
  nobody can say whether the write landed. The console deliberately reloads the
  authoritative state instead of sending the same change twice. Check what the
  reloaded rule says, then decide. This is why you will never end up with a
  rule created twice.

---

## 2. Verification → Scopes: the mandatory method

This is the ONE place where verification becomes mandatory. Until you publish a
row with a method on it, nothing here affects members. There used to be two
places — a method list on the location scopes and a separate "Forced & waiting
room" tab — and they could contradict each other. They are now a single table.

### 2.1 What a mandatory method does to a member

A member who has not completed the mandatory method is placed in the **Waiting
Room**: a full-screen page that replaces the app's normal surfaces. From there
they can start verification, reach support, sign out or delete their own
account — nothing else. Ordinary browsing, chat and profiles are closed until
they are verified.

This is a heavy switch. Read section 2.6 before turning it on anywhere.

### 2.2 One row, one method

Every row of the table carries exactly ONE value:

- **Persona ID check** — the identity check.
- **Selfie video** — the moderator-reviewed video selfie.
- **None** — nothing is mandatory for that row.

There is no "both". A member is never asked for two methods at once.

The first row is the **Global** row: it applies to every storefront without an
override and to members whose storefront is unknown. Below it you may add
**storefront overrides**, chosen from the App Store country list. An override
replaces the global value for that storefront — it is a replacement, not an
addition.

A method the deployment cannot serve today is offered but cannot be published;
the row says why (for example "deployment unlock is disabled"). A value that is
already live stays visible even if its method later becomes unavailable.

### 2.3 Completion counts once, whichever method earned it

A member who has already completed Persona or the video selfie, whose
verification was imported from the old system, or who carries an active
administrator grant, stays verified when you change the mandatory method. You
never send an already-verified member back through a second method.

### 2.4 The Waiting Room text, per row

Open **Edit Waiting Room copy** on a row to edit its title, subtitle and
description in English and Hungarian. On the Global row both languages are
required; on a storefront row a field you leave blank inherits the global text
of the same language.

Each language also has an optional **Help URL**. When one is set, the Waiting
Room shows a round "?" button in its top-right corner that opens the address in
an in-app browser sheet over the room; leave it blank and there is no button.
The address must start with `https://`, be at most 2048 bytes and carry no
credentials. A storefront row left blank inherits the global URL, exactly like
the three text fields, and the phone preview shows the button only where an
effective URL exists. The URL is presentation only: it never lets a member past
the gate.

Two practical notes:

- Ordinary spaces at the edges are trimmed automatically. A "space" that is a
  non-breaking or other Unicode space is refused instead, because it would look
  empty while not being empty. If a pasted text is rejected for that reason,
  retype the edges by hand.
- The preview under the editor shows the phone screen in light and dark for
  that row. When a field is not valid yet, the preview shows the compiled
  built-in text for that field and says so, so you always see something
  realistic.

### 2.5 Draft, impact preview, publish — in that order

Nothing you type is live until you publish, and publishing takes three steps:

1. **Save draft.** The draft is stored against the revision you loaded. If
   somebody else changed the policy meanwhile you get a conflict, your draft is
   not written, and the authoritative version is shown.
2. **Preview impact.** Core counts, per storefront, how many members are gated
   now, how many the saved draft would gate, how many already satisfy it, and
   how many would be newly gated or newly released. Counts only — never names
   or member data.
3. **Publish reviewed draft.** Type the exact phrase shown, give a private
   reason, and publish. You publish exactly the revision you previewed: any
   edit, or anyone else's save, invalidates the preview and you take a new one.

Treat a large "newly gated" number as a business decision, not a technical
detail: those members lose access to the app until they verify.

### 2.6 The rollout rule — do not skip this

**Make a method mandatory only after the iOS build that contains the Waiting
Room is live in the App Store.**

The reason is simple. The gate is enforced by the server for every app version.
An older app that does not know the Waiting Room receives the refusal without
having a screen to show for it, so the member sees a dead end instead of a way
to verify. Members do not all update on the same day, so:

1. The iOS release with the Waiting Room reaches the App Store.
2. Wait until the great majority of active members are on it (check your
   analytics; a few days is normal).
3. Only then publish a mandatory method, and prefer one storefront first.
4. Watch support volume for a day before widening.

Setting a row back to **None** and publishing is immediate and safe: members
return to the app on their next request.

### 2.7 Where the video product's own page fits

**Configuration → Profile video verification** still owns the video flow's
wording, prompts and appearance. It no longer has an enable switch: whether
video is mandatory is decided here, on the Scopes table, and that page shows
the derived answer as a read-only line.

---

## 3. Quick answers

**A member says the app looks wrong for their country.** Run the test preview
with their storefront and location. The matched rule tells you which level is
responsible.

**A campaign should end tonight.** Set the end instant in the event window
instead of deleting the rule; it stops resolving on its own and the level below
takes over.

**I want one country to keep the old look.** Give that storefront a rule that
sets exactly the fields you changed globally, back to the old values.

**The colours look right in light mode and unreadable in dark.** The two modes
are separate; check "text on accent" in the dark preview.

**Did my change reach members?** The rule list shows the live state; the test
preview shows exactly what a device would receive right now.
