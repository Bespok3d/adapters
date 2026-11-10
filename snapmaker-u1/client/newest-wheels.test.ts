// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'

import { compareWheelVersions, newestWheelPerProject } from './newest-wheels'

// Each pair is in PEP 440 order, the older version first.
const OLDER_THEN_NEWER = [
  ['1.9.0', '1.10.0'],
  ['1.0rc1', '1.0'],
  ['1.0', '1.0.post1'],
  ['1.0.dev1', '1.0a1'],
  ['1.0a1', '1.0b1'],
  ['1.0b2', '1.0rc1'],
  ['1.0a1.dev1', '1.0a1'],
  ['1.0', '1.0.post1.dev1'],
  ['1.0.post1.dev1', '1.0.post1'],
  ['2.0', '1!0.1'],
]

describe('compareWheelVersions', () => {
  it.each(OLDER_THEN_NEWER)('puts %s before %s', (olderVersion, newerVersion) => {
    expect(compareWheelVersions(olderVersion, newerVersion)).toBe(-1)
    expect(compareWheelVersions(newerVersion, olderVersion)).toBe(1)
  })

  it('reads a release padded with zeros as the same version', () => {
    expect(compareWheelVersions('1.0', '1.0.0')).toBe(0)
  })

  it('refuses a version it cannot order', () => {
    expect(() => compareWheelVersions('1.0+local', '1.0')).toThrow('Cannot order the wheel version "1.0+local"')
  })
})

describe('newestWheelPerProject', () => {
  it('keeps only the newest wheel of each project', () => {
    const printerWheels = [
      'wheels/fastapi-0.115.0-py3-none-any.whl',
      'wheels/starlette-0.38.0-py3-none-any.whl',
      'wheels/fastapi-0.114.0-py3-none-any.whl',
    ]

    expect(newestWheelPerProject(printerWheels)).toEqual([
      'wheels/fastapi-0.115.0-py3-none-any.whl',
      'wheels/starlette-0.38.0-py3-none-any.whl',
    ])
  })

  it('counts names that differ only in case and separators as one project', () => {
    expect(newestWheelPerProject(['wheels/Typing_Extensions-4.12.0-py3-none-any.whl', 'wheels/typing.extensions-4.11.0-py3-none-any.whl']))
      .toEqual(['wheels/Typing_Extensions-4.12.0-py3-none-any.whl'])
  })

  it('keeps the only wheel of a project without reading its version', () => {
    expect(newestWheelPerProject(['wheels/torch-2.0.0+cpu-cp311-none-any.whl'])).toEqual(['wheels/torch-2.0.0+cpu-cp311-none-any.whl'])
  })
})
