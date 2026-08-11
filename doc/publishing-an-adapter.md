# Publishing an adapter

Your adapter becomes part of Bespok3d by being merged into this repo. There is no separate
registration, no account to create, and nothing to sign up for.

This page is what happens after the code works. Get there with
[adapter-zero-to-hero.md](adapter-zero-to-hero.md) first.

## The short version

1. Open a pull request against `dev`.
2. Sign off your commits.
3. The gate has to be green.
4. A maintainer reviews it, merges it, and tags a release.
5. The printer half is built and signed by CI and published for the app to fetch.
6. The app half ships with the next app release.

## What has to be in the pull request

| | |
| --- | --- |
| Both halves | `client/` and `jinni/`, complete |
| The fake printer | `testkit/fixture.json` and `testkit/skeleton/`, passing the generic runner |
| Tests | next to the code, in the same change |
| A green gate | `bash <your-printer>/scripts/check.sh` |
| The acceptance list | from the zero to hero page, ticked honestly |
| What you ran on hardware | which steps, on what printer, on which firmware version |

That last line matters more than it looks. An adapter reviewed as code but never run on the machine is
the one that breaks in someone's living room. Say plainly what you tested and what you did not. An
untested area named in the pull request is a normal thing to merge. An untested area presented as
tested is not.

## Signing off

Every commit carries a `Signed-off-by` line. It is your statement that you wrote the change, or
otherwise have the right to contribute it, under the Developer Certificate of Origin
(<https://developercertificate.org/>).

```sh
git commit -s -m "your message"
```

A pull request whose commits are not signed off cannot be merged.

## Licence

This repository is AGPL-3.0-or-later. Your contribution is under those same terms.

You keep the copyright in what you write. There is no copyright assignment and no contributor licence
agreement.

## What the maintainer does after merging

The two halves publish differently, because they run in different places.

### The printer half publishes as a signed package

Your jinni ships the same way every other thing Bespok3d installs does: as one signed package per
adapter.

- **What it is.** A maintainer pushes a tag of the form `jinni-<your-printer>-v<version>`. CI refuses
  anything that is not a release tag, runs the shared checks, stages the package contents, and hands
  them to the org's build action, which packs the package, stamps the publisher, and signs it. The
  result is a release asset the app can fetch.
- **Why it is there.** The user's app verifies the signature before installing. That is what makes it
  safe to install an adapter written by someone the user has never met, and it is why signing is done
  by the build rather than on anyone's laptop.

Your `jinni/manifest.json` carries a placeholder publisher in the source tree. Leave it. The build
stamps the real one, and a placeholder that reached a built package would be a defect.

Because the printer half is a package, it updates on its own. A fix to your jinni reaches users
without waiting for an app release, and the app tells a user when their printer is running an older
one than the app carries.

### The app half ships with the app

The client is compiled into the desktop app build. It reaches users in the next app release, not
before.

Two consequences worth knowing:

- A change to your client waits for an app release. Put anything that will need fast fixes on the
  jinni side where you can.
- The app carries a copy of the daemon and the printer half for the adapters it bundles, so a printer
  that answers on SSH and nothing else can still be enrolled with no internet. That is why the first
  install works on a printer that has never been online.

### Discovery

For the app to pick your adapter automatically for a discovered printer, the app has to map that
printer's announced vendor and model to your adapter id. That mapping lives in the app repo, so the
maintainer adds it when your adapter is merged. Tell them in the pull request exactly what your
printer announces itself as.

## Versions

| Half | Where its version lives | Who bumps it |
| --- | --- | --- |
| The jinni | `jinni/version.json`, mirrored in `jinni/manifest.json` | you, in the change |
| The client | `version` in your entry module | you, in the change |

Bump the half you changed. If you changed both, bump both. There is no third place to update: the app
reads the jinni version out of the same file the jinni does.

## After it is in

Your adapter is now something strangers run on hardware you have never seen. What that asks of you:

- When a firmware update from your vendor breaks it, that is the thing to fix first.
- When a user reports something, the useful reply names their firmware version and yours.
- When a capability turns out not to work, unadvertising the flag is the correct fix and is better
  than a workaround.

## If you would rather not maintain it

Say so in the pull request. An adapter contributed and then handed over is genuinely useful and is
better than one that never lands. What is not useful is an adapter that looks maintained and is not,
because a user picking it has no way to tell the difference.
