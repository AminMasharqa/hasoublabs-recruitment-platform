/**
 * Unit tests for the Status_Notice surface derivation (task 15.3).
 *
 * Requirement 7:
 * - AC3 every contract Account_Status resolves a localized status name, a
 *   description and a next step in all three catalogues.
 * - AC4 exactly `PendingVerification` offers the Verification_Code control.
 * - AC5 exactly `Rejected`, `Suspended` and `Deactivated` are the closed-down
 *   statuses the notice presents no action for.
 *
 * The status set is read from `ACCOUNT_STATUS_VALUES`, i.e. from the generated
 * contract, so a status the Backend_Api adds fails here instead of reaching the
 * screen untranslated.
 */

import { describe, expect, it } from 'vitest'

import { createI18n } from '../../i18n'
import { SUPPORTED_LOCALES } from '../../lib/locale'
import { ACCOUNT_STATUS_VALUES } from '../../routing/access'

import {
  isTerminalStatus,
  offersVerification,
  statusNoticeKeys,
  statusNoticeSurface,
  TERMINAL_STATUSES,
  VERIFICATION_STATUS,
} from './statusNotice'

describe('the Verification_Code control (Req 7 AC4)', () => {
  it('is offered for PendingVerification and for no other status', () => {
    for (const status of ACCOUNT_STATUS_VALUES.values) {
      expect(offersVerification(status), status).toBe(status === 'PendingVerification')
    }
    expect(VERIFICATION_STATUS).toBe('PendingVerification')
  })

  it('is not offered when the status is not yet known', () => {
    expect(offersVerification(null)).toBe(false)
    expect(offersVerification(undefined)).toBe(false)
  })
})

describe('the closed-down statuses (Req 7 AC5)', () => {
  it('names exactly Rejected, Suspended and Deactivated', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['Deactivated', 'Rejected', 'Suspended'])
    for (const status of ACCOUNT_STATUS_VALUES.values) {
      expect(isTerminalStatus(status), status).toBe(TERMINAL_STATUSES.includes(status))
    }
  })

  it('offers no Verification_Code control for any of them', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(statusNoticeSurface(status)).toMatchObject({ terminal: true, verification: false })
    }
  })

  it('treats an unknown status as not closed down', () => {
    expect(isTerminalStatus(null)).toBe(false)
  })
})

describe('the localized surface of each status (Req 7 AC3)', () => {
  it('resolves a status name, a description and a next step in ar, he and en', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createI18n(locale)
      for (const status of ACCOUNT_STATUS_VALUES.values) {
        const keys = statusNoticeKeys(status)
        for (const key of [keys.statusKey, keys.descriptionKey, keys.nextStepKey]) {
          expect(i18n.exists(key), `${locale}:${key}`).toBe(true)
          // `parseMissingKeyHandler` echoes the key, so an echo is a miss.
          expect(String(i18n.t(key)), `${locale}:${key}`).not.toBe(key)
        }
      }
    }
  })

  it('keys every entry under the onboarding namespace and the status member', () => {
    expect(statusNoticeKeys('Suspended')).toEqual({
      statusKey: 'onboarding:status.Suspended',
      descriptionKey: 'onboarding:description.Suspended',
      nextStepKey: 'onboarding:nextStep.Suspended',
    })
  })

  it('carries the retained status on the derived surface', () => {
    expect(statusNoticeSurface('PendingVerification')).toEqual({
      status: 'PendingVerification',
      statusKey: 'onboarding:status.PendingVerification',
      descriptionKey: 'onboarding:description.PendingVerification',
      nextStepKey: 'onboarding:nextStep.PendingVerification',
      verification: true,
      terminal: false,
    })
  })
})
