# Anatomy of a client

The client is the half of your adapter that runs on the user's computer, inside the Bespok3d desktop
app. It has one big job and one small one.

The big job is enrollment: take a printer that has never heard of Bespok3d, reachable only over SSH,
and leave it running our daemon, without breaking anything the vendor put there. The small job is
staying available afterwards for the device operations the app offers, such as updating the printer
half.

This page assumes you have read [anatomy-of-an-adapter.md](anatomy-of-an-adapter.md).

## The client may import exactly one thing

```typescript
import { registerAdapter, connect, shellQuote } from '@adapter-sdk'
```

- **What it is.** `@adapter-sdk` is the app's adapter loader surface: the register function, the SSH
  transport, the package readers, and the types below. That alias is the whole vocabulary available to
  you.
- **Why it is there.** It is a promise in both directions. You never break when the app is refactored,
  and the app never breaks because an adapter reached somewhere it should not have. An import of
  anything else is rejected in review.

If you need something the SDK does not offer, say so in an issue. The answer is either a new SDK
export or a different design, never a shortcut around it.

## `registerAdapter`: the whole client, declared once

Your entry module calls it at load with one object. That object is your client.

| Field | What it is | Notes |
| --- | --- | --- |
| `id` | the adapter id | matches your directory name |
| `title`, `vendor` | what the user reads | the printer's real name, not ours |
| `version` | the client version | you bump this by hand |
| `jinniVersion` | the printer half's version | read from `jinni/version.json`, never typed |
| `jinniPackage` | the package name your jinni ships as | matches `jinni/manifest.json` |
| `description` | one paragraph, shown in the app | say what it supports and what it will not touch |
| `icon` | the printer's picture | a `data:` URL, because the app refuses remote images |
| `defaults` | SSH user, port, password hint, runtime user | the hint is shown to the user, so it must be the vendor's documented default |
| `envVars` | the path variables plugins may use | values come from `paths.json`, never a second copy |
| `enrollSteps` | the ordered enrollment recipe | see below |
| `opSteps` | operations that are not part of enrollment | optional |
| `verifyEnrolled` | is this printer set up, right now | see below |

## `enrollSteps`: the recipe, and the one rule

A step is four things: a stable id, a label the user reads while it runs, a detail line explaining
what it is about to do, and the function that does it.

```typescript
{
  id: 'create-workspace',
  label: 'Create the Bespok3d workspace',
  detail: 'Makes the directory tree Bespok3d owns, on the part of the disk that survives a firmware update.',
  run: async (ssh, ctx) => { /* ... */ },
}
```

- **What it is.** The app runs your steps in order, in a list the user can watch, and stops on the
  first one that throws.
- **Why it is there.** Enrollment is the moment of highest risk in the whole product. Splitting it into
  named steps is what lets a failure name itself, lets the user retry from the step that failed rather
  than from the start, and lets us tell someone exactly what we did to their printer.

**Every step must be idempotent.** Running it twice on the same printer must leave the same result and
must not fail. This is not a style preference:

- Each step gets its own fresh SSH session, so a step cannot rely on state left in a shell.
- A step that fails on a connection error is retried, up to three attempts, with a growing delay.
- A user retrying enrollment from a failed step means every step before it has already run once.

Write each step as "make it so", never "do it". Check before you create, tolerate what is already
there, and do not error because the work was already done.

The label and detail are read by someone who has never heard of a jinni and is watching their printer
being changed. Say what happens to the printer, in ordinary words. No file names, no protocols, no
term you invented while writing it. One sentence per fact.

## `opSteps`: operations, and none of them are optional

`opSteps` is short for operations: work the app invokes by id on a printer that is already enrolled.
The word is not "optional". Nothing in this list is a nice to have.

**Your adapter must supply a step with the id `deploy-jinni`.** The printer half carries its own
version, separate from the app and the daemon, so when a newer one ships the app has to be able to put
it on a printer that is already enrolled without enrolling it again. The app asks for that by this
exact id. An adapter without it ships a printer whose device half can never be updated, and the only
route left to the user is to enroll the whole thing from scratch.

That step replaces the printer half and nothing else. The daemon, its certificate and the installed
plugins are left exactly where they are.

Op steps are written exactly like enroll steps and carry the same idempotence rule. The only
difference is that they are not in the enrollment list, so they never run at enrollment time.

## `verifyEnrolled`: two questions, not one

```typescript
verifyEnrolled: (ssh: SshSession) => Promise<boolean>
```

- **What it is.** True only when the printer is set up **and** that setup will survive a reboot.
- **Why it is there.** On a printer with a write layer, a firmware update can leave every one of our
  files in place while quietly making the machine unable to keep new ones. The user sees a working
  printer; the next reboot loses everything. So this function checks both our workspace and the write
  layer, and returning false is what makes the app offer a one click repair.

If your printer has an ordinary writable filesystem, the second question answers itself and this is
just a presence check.

## One worked example, in order

The reference adapter is for a Snapmaker U1, a printer picked because it is awkward in almost every
way a printer can be. Its fifteen steps are not a template. They are here so you can see the shape a
step takes and the order the groups fall into. Your printer will need some of these, will not need
others, and may well need one that is not here at all.

| Group | What it does | Why that printer needs it |
| --- | --- | --- |
| Look before touching | Refuses to start if the printer is mid print, or is not the model it claims to be | Enrollment changes the machine, and doing that under a running print ruins the print |
| Make writes stick | Unlocks the printer's write layer, puts the WiFi credentials somewhere that survives it, reboots and waits for the printer to come back | Until that layer is unlocked, everything written to this printer is gone at the next reboot, and unlocking it costs a reboot |
| Make the network dependable | Clears the stale network state that reboot left behind | Without it the printer never reappears and enrollment ends there |
| Build our home | Creates the one directory tree Bespok3d owns | It sits on the storage a vendor firmware update does not wipe |
| Get started at boot | Extends a start-up script the vendor already ships so that it also starts ours | This printer's boot sequence ignores any file added over SSH, so a new start-up script would simply never run |
| Join the stock system | Adds our own web and config entries to the ones already there | So a plugin can add a web address or a Klipper setting without anyone editing the user's own files |
| Install the daemon | Puts the daemon and the printer half on the machine, then gives them an identity of their own | Both arrive as signed packages, and the identity is what the app authenticates against from then on |
| Start and prove | Starts the daemon and asks the printer to confirm it is running | Never report success on something that was not observed working |

The last group is the shape that matters most. A step reports done when the printer proved it, not
when a command exited zero.

## The files, and what each one is allowed to know

The client is split by concern, one file per thing, none of them large.

| File | Its one job |
| --- | --- |
| `<adapter-id>.ts` | the entry: builds the definition and calls `registerAdapter` |
| `enroll-steps/` | one file per step, plus the ordered list |
| `paths.ts` | reads `jinni/paths.json`, so no path is typed twice |
| `env-vars.ts` | the variable contract plugin authors write against |
| `version.ts` | reads `jinni/version.json` |
| `packages.ts` | the names of the packages this adapter installs |
| `package-deploy.ts` | puts a package's payload on the printer, and only what the package owns |
| `stock-patches.ts` | pure functions that patch vendor files, idempotent by construction |
| `reconnect.ts` | waiting for a printer to come back after a reboot |
| `print-state.ts` | is this printer printing right now |
| `overlay.ts` | this printer's write layer |
| `icon.ts` | the picture |

Keep files under roughly 150 lines. The gate holds that ceiling, and a file that grew past it is
almost always two concerns that were never separated.

## Rules the gate will hold you to

- No em-dash and no en-dash anywhere, including comments. Use a comma, a colon, or two sentences.
- Names say what a thing is in the domain. No `a`, `b`, `tmp`, `data`, no single letters.
- Nesting past one level is a smell. Return early, or extract a named function.
- Every behaviour gets a test next to it. A bug fix gets a test that fails on the old behaviour.
- Never build a shell command by pasting a value in. Use `shellQuote`.

## How to test it without a printer

Write the fake device instead. `testkit/fixture.json` names your printer's facts and
`testkit/skeleton/` is a directory tree standing in for its filesystem, with paths written as the
variables from your `paths.json`. The runner is generic, so the whole enrollment and install path runs
against your description with no hardware attached.

That is the loop you develop in. The real printer is where you confirm it, not where you find out.
