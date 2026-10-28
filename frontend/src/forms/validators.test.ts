import { describe, expect, it } from 'vitest'

import {
  BOUNDS,
  countCodePoints,
  isAddrSpec,
  isHttpsUrl,
  isSixDigitCode,
  isValidLinkedInUrl,
  isValidRating,
  SCHEMAS,
  validateCandidateProfile,
  validateCvUploadSize,
  validateDateOrder,
  validateEducationEntries,
  validateEmail,
  validateLinkedInUrl,
  validatePassword,
  validateRating,
  validateSchema,
  validateSixDigitCode,
  validateWorkExperienceEntries,
  WORK_MODEL_VALUES,
} from './validators'

describe('countCodePoints', () => {
  it('counts astral characters once, not as two UTF-16 units', () => {
    expect(countCodePoints('😀')).toBe(1)
    expect('😀'.length).toBe(2)
    expect(countCodePoints('a😀b')).toBe(3)
    expect(countCodePoints('')).toBe(0)
  })
})

describe('validatePassword', () => {
  it('accepts exactly the minimum counted in code points', () => {
    expect(validatePassword('😀'.repeat(10))).toBeNull()
    expect(validatePassword('a'.repeat(10))).toBeNull()
  })

  it('rejects nine code points even when the UTF-16 length clears the bound', () => {
    const nineCodePoints = '😀'.repeat(9)
    expect(nineCodePoints.length).toBeGreaterThanOrEqual(BOUNDS.password.minCodePoints)
    expect(validatePassword(nineCodePoints)?.code).toBe('password_policy')
  })

  it('accepts 64 code points and rejects beyond the maximum', () => {
    expect(validatePassword('a'.repeat(64))).toBeNull()
    expect(validatePassword('a'.repeat(BOUNDS.password.maxCodePoints + 1))?.code).toBe(
      'password_policy',
    )
  })

  it('reports an absent value as required', () => {
    expect(validatePassword('')?.code).toBe('required')
    expect(validatePassword(undefined)?.code).toBe('required')
  })
})

describe('isAddrSpec', () => {
  it('accepts dot-atom, quoted-string and domain-literal forms', () => {
    expect(isAddrSpec('candidate@example.com')).toBe(true)
    expect(isAddrSpec("o'brien+tag@sub.example.co.il")).toBe(true)
    expect(isAddrSpec('"quoted local"@example.com')).toBe(true)
    expect(isAddrSpec('user@[192.168.0.1]')).toBe(true)
  })

  it('rejects malformed addresses', () => {
    expect(isAddrSpec('no-at-sign')).toBe(false)
    expect(isAddrSpec('@example.com')).toBe(false)
    expect(isAddrSpec('user@')).toBe(false)
    expect(isAddrSpec('.leading@example.com')).toBe(false)
    expect(isAddrSpec('double..dot@example.com')).toBe(false)
    expect(isAddrSpec('spaces are@example.com')).toBe(false)
    expect(isAddrSpec(42)).toBe(false)
  })
})

describe('validateEmail', () => {
  it('reports a malformed address and respects the declared length bound', () => {
    expect(validateEmail('nope')?.code).toBe('malformed_email')
    const long = `${'a'.repeat(BOUNDS.email.maxLength)}@example.com`
    expect(validateEmail(long)?.code).toBe('too_long')
  })

  it('treats an absent optional value as valid and an absent required value as missing', () => {
    expect(validateEmail('')).toBeNull()
    expect(validateEmail(undefined, { required: true })?.code).toBe('required')
  })
})

describe('LinkedIn URL', () => {
  it('accepts a well-formed HTTPS URL within 200 characters', () => {
    expect(isValidLinkedInUrl('https://www.linkedin.com/in/someone')).toBe(true)
    expect(validateLinkedInUrl('https://www.linkedin.com/in/someone')).toBeNull()
  })

  it('rejects a non-HTTPS scheme, a malformed URL and one over 200 characters', () => {
    expect(isHttpsUrl('http://www.linkedin.com/in/someone')).toBe(false)
    expect(isHttpsUrl('https://')).toBe(false)
    expect(isHttpsUrl('https://exa mple.com')).toBe(false)
    const overLong = `https://www.linkedin.com/in/${'a'.repeat(BOUNDS.linkedinUrl.maxLength)}`
    expect(isValidLinkedInUrl(overLong)).toBe(false)
    expect(validateLinkedInUrl(overLong)?.code).toBe('invalid_url')
  })

  it('leaves the optional field alone when it is empty', () => {
    expect(validateLinkedInUrl('')).toBeNull()
    expect(validateLinkedInUrl(null)).toBeNull()
  })
})

describe('six-digit codes', () => {
  it('accepts exactly six ASCII digits', () => {
    expect(isSixDigitCode('012345')).toBe(true)
    expect(validateSixDigitCode('012345')).toBeNull()
  })

  it('rejects other lengths, non-digits and localized digit shapes', () => {
    expect(isSixDigitCode('12345')).toBe(false)
    expect(isSixDigitCode('1234567')).toBe(false)
    expect(isSixDigitCode('12345a')).toBe(false)
    expect(isSixDigitCode('١٢٣٤٥٦')).toBe(false)
    expect(validateSixDigitCode('12345')?.code).toBe('invalid_code_format')
    expect(validateSixDigitCode('')?.code).toBe('required')
  })
})

describe('ratings', () => {
  it('accepts integers 1 through 5', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(isValidRating(rating)).toBe(true)
      expect(validateRating(rating)).toBeNull()
    }
  })

  it('rejects out-of-range, fractional and non-numeric values', () => {
    expect(isValidRating(0)).toBe(false)
    expect(isValidRating(6)).toBe(false)
    expect(isValidRating(3.5)).toBe(false)
    expect(isValidRating('3')).toBe(false)
    expect(isValidRating(Number.NaN)).toBe(false)
    expect(validateRating(6)?.code).toBe('out_of_range')
    expect(validateRating(null)?.code).toBe('required')
  })
})

describe('validateDateOrder', () => {
  it('accepts an end that equals or follows the start, and an absent end', () => {
    expect(validateDateOrder({ start: 2010, end: 2010, index: 0 })).toBeNull()
    expect(validateDateOrder({ start: 2010, end: 2012, index: 0 })).toBeNull()
    expect(validateDateOrder({ start: 2010, end: null, index: 0 })).toBeNull()
    expect(
      validateDateOrder({ start: '2020-01-01', end: '2020-01-02', index: 4 }),
    ).toBeNull()
  })

  it('rejects an end before the start and names the entry index', () => {
    const found = validateDateOrder({
      start: 2015,
      end: 2014,
      index: 2,
      collection: 'education',
      endField: 'end_year',
    })
    expect(found?.code).toBe('end_before_start')
    expect(found?.path).toBe('education.2.end_year')
    expect(found?.params?.index).toBe(2)
    expect(found?.params?.entryNumber).toBe(3)
  })

  it('rejects an end date before the start date', () => {
    const found = validateDateOrder({
      start: '2021-06-01',
      end: '2020-06-01',
      index: 0,
      collection: 'work_experience',
      endField: 'end_date',
    })
    expect(found?.path).toBe('work_experience.0.end_date')
  })
})

describe('entry collections', () => {
  const education = [
    {
      institution: 'Technion',
      degree: 'BSc',
      enrolment_status: 'Graduated',
      start_year: 2015,
      end_year: 2019,
    },
    {
      institution: 'Open University',
      degree: 'MSc',
      enrolment_status: 'Enrolled',
      start_year: 2020,
      end_year: 2019,
    },
  ]

  it('reports every failing entry at once, each against its own index', () => {
    const issues = validateEducationEntries(education)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('education.1.end_year')
  })

  it('applies the per-entry bounds and the enumerated value set', () => {
    const issues = validateEducationEntries([
      { institution: '', degree: 'BSc', enrolment_status: 'Attending', start_year: 1800 },
    ])
    expect(issues.map((found) => found.code).sort()).toEqual([
      'invalid_enum',
      'out_of_range',
      'required',
    ])
  })

  it('applies the collection size bound', () => {
    const many = Array.from({ length: 21 }, () => education[0]!)
    const issues = validateWorkExperienceEntries([])
    expect(issues).toHaveLength(0)
    expect(validateEducationEntries(many).some((found) => found.code === 'too_many_items')).toBe(
      true,
    )
  })
})

describe('validateSchema', () => {
  it('reports every violated field rather than only the first', () => {
    const issues = validateSchema(SCHEMAS.review, {
      rating_technical: 0,
      rating_communication: 3,
      rating_culture_fit: 9,
      rating_overall: 4,
      assessment: '',
    })
    expect(issues.map((found) => found.path).sort()).toEqual([
      'assessment',
      'rating_culture_fit',
      'rating_technical',
    ])
  })

  it('accepts a body that satisfies every declared bound', () => {
    expect(
      validateSchema(SCHEMAS.registration, {
        role: 'CANDIDATE',
        email: 'candidate@example.com',
        password: 'a-long-enough-secret',
        full_name: 'أحمد',
        language_preference: 'ar',
        residency_proof_type: 'MobilePhone',
        residency_proof_value: '+972500000000',
        link_token: 'tok_123',
      }),
    ).toEqual([])
  })

  it('reports an out-of-set enum value', () => {
    const issues = validateSchema(SCHEMAS.jobCreate, {
      title: 'Backend engineer',
      company: 'HasoubLabs',
      work_model: 'Anywhere',
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('invalid_enum')
    expect(WORK_MODEL_VALUES.includes('Anywhere')).toBe(false)
  })
})

describe('validateCandidateProfile', () => {
  it('collects scalar, entry and ordering issues together', () => {
    const issues = validateCandidateProfile({
      full_name: 'Sara',
      linkedin_url: 'http://linkedin.com/in/sara',
      education: [
        {
          institution: 'Technion',
          degree: 'BSc',
          enrolment_status: 'Graduated',
          start_year: 2015,
          end_year: 2014,
        },
      ],
      work_experience: [],
    })
    expect(issues.map((found) => found.path).sort()).toEqual([
      'education.0.end_year',
      'linkedin_url',
    ])
  })
})

describe('validateCvUploadSize', () => {
  it('rejects a selection over the declared upload bound', () => {
    expect(validateCvUploadSize(BOUNDS.cv.maxUploadBytes)).toBeNull()
    expect(validateCvUploadSize(BOUNDS.cv.maxUploadBytes + 1)?.code).toBe('file_too_large')
  })
})
