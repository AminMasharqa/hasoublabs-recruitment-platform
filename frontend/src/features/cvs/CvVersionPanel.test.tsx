/**
 * Component tests for the CV_Version panel (task 17.3).
 *
 * Requirement 11, as the mounted surface behaves rather than as its rules read:
 * - AC10 the upload control renders the transferred byte percentage while the
 *   request is in flight, and the figure follows the bytes the transport takes.
 * - AC12 a listed `PendingScan` version re-queries the version list at an
 *   interval of at most 10 seconds, and the poll stops on the answer that resolves
 *   it — asserted by a request count that stops growing.
 * - AC13/AC14 the download control is disabled, with the reason stated, for a
 *   `PendingScan` and for a `Quarantined` version, and the quarantined version
 *   stays in the list.
 * - AC16 an `Available` version's control asks the download path and hands the
 *   bytes to the browser under the original filename.
 *
 * The pure decisions behind all four — the ordering, the gating, the poll
 * interval, the percentage arithmetic — are covered by `versionRules.test.ts`,
 * `versionUpload.test.ts` and `versionDownload.test.ts`. What is asserted here is
 * only what mounting adds: that the panel renders those decisions, that the poll
 * is really driven by a timer, and that a click reaches the endpoint.
 */

import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { i18n as I18nextInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiClient, ApiSuccess } from '../../api/client'
import { createI18n } from '../../i18n'
import { AppServicesContext, type AppServices } from '../../shell/appServices'

import { CvVersionPanel } from './CvVersionPanel'
import { CV_VERSION_DOWNLOAD_PATH, CV_VERSIONS_PATH } from './versionApi'
import { VERSION_POLL_INTERVAL_MS, type CvUploadAccepted, type CvVersion } from './versionRules'

const VARIANT_ID = 'variant-1'
const PDF = 'application/pdf'

/**
 * jsdom implements no object URLs, and the delivery of AC16 asks for one to hang
 * off the anchor it clicks. Stubbed at module scope rather than per test so the
 * automatic mock restoration cannot take it away mid-suite; the URL itself is
 * never asserted on — the filename beside it is what AC16 is about.
 */
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    configurable: true,
    value: () => 'blob:cv-version',
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    writable: true,
    configurable: true,
    value: () => undefined,
  })
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function version(overrides: Partial<CvVersion> & Pick<CvVersion, 'id'>): CvVersion {
  return {
    variant_id: VARIANT_ID,
    version_number: 1,
    state: 'PendingScan',
    original_filename: 'cv.pdf',
    mime_type: PDF,
    size_bytes: 2048,
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function accepted(entry: CvVersion): CvUploadAccepted {
  return { message: 'Upload accepted, scan pending', version: entry }
}

/** A file of `bytes` bytes, so the streamed body is pulled in several chunks. */
function fileOf(bytes: number, name = 'cv.pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type: PDF })
}

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      index += 1
      if (chunk === undefined) {
        controller.close()
        return
      }
      controller.enqueue(chunk)
    },
  })
}

// ── Harness ───────────────────────────────────────────────────────────────────

/** One recorded request: what the panel asked for, and of which resource. */
interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly pathParams: Record<string, unknown> | undefined
}

interface Backend {
  readonly api: ApiClient
  readonly requests: readonly RecordedRequest[]
  /** How many times the version list has been read — the poll's own counter. */
  readonly reads: () => number
  /** Pulls one chunk of the in-flight upload body, as a transport would. */
  readonly transferChunk: () => Promise<void>
  /** Answers the held upload with a 202 carrying `entry`. */
  readonly acceptUpload: (entry: CvVersion) => void
}

/**
 * An Api_Client answering the three requests this panel issues.
 *
 * The version list is answered from a queue — one entry per read, holding on the
 * last — which is what lets AC12's poll be observed resolving. The upload is
 * *held*: its body is taken but the response is not sent until the test says so,
 * so the in-flight percentage of AC10 is observable, and the body is drained one
 * chunk at a time rather than all at once, so the figure can be watched moving.
 */
function backend(
  options: {
    readonly lists?: readonly (readonly CvVersion[])[]
    readonly downloadChunks?: readonly Uint8Array[]
    readonly downloadHeaders?: Record<string, string>
  } = {},
): Backend {
  const lists = options.lists ?? [[]]
  const requests: RecordedRequest[] = []
  let reads = 0
  let pullBody: (() => Promise<unknown>) | null = null
  let sendAccepted: ((entry: CvVersion) => void) | null = null

  const answer = (data: unknown, init: ResponseInit = { status: 200 }): ApiSuccess<unknown> => ({
    data,
    response: new Response(null, init),
    supportReference: 'req-ok',
  })

  const request = vi.fn((method: string, path: string, init?: unknown) => {
    const typed = init as
      | {
          params?: { path?: Record<string, unknown> }
          body?: unknown
          bodySerializer?: (body: unknown) => unknown
        }
      | undefined
    requests.push({ method, path, pathParams: typed?.params?.path })

    if (method === 'get' && path === CV_VERSIONS_PATH) {
      const list = lists[Math.min(reads, lists.length - 1)] ?? []
      reads += 1
      return Promise.resolve(answer(list.map((entry) => ({ ...entry }))))
    }

    if (method === 'post' && path === CV_VERSIONS_PATH) {
      // The Api_Client calls the serializer once per attempt; a stream body is
      // the only shape that can report a byte count, so nothing else is accepted.
      const body = typed?.bodySerializer?.(typed.body)
      if (!(body instanceof ReadableStream)) {
        return Promise.reject(new Error('the upload body was not a stream'))
      }
      const reader = (body as ReadableStream<Uint8Array>).getReader()
      pullBody = () => reader.read()
      return new Promise<ApiSuccess<unknown>>((resolve) => {
        sendAccepted = (entry) => {
          resolve(answer(accepted(entry), { status: 202 }))
        }
      })
    }

    if (method === 'get' && path === CV_VERSION_DOWNLOAD_PATH) {
      const chunks = options.downloadChunks ?? [new Uint8Array([1, 2, 3, 4])]
      return Promise.resolve(
        answer(streamOf(chunks), {
          status: 200,
          headers: options.downloadHeaders ?? { 'Content-Length': '4', 'Content-Type': PDF },
        }),
      )
    }

    return Promise.reject(new Error(`unexpected ${method} ${path}`))
  })

  return {
    api: {
      request: request as unknown as ApiClient['request'],
      exchangeRefreshToken: () => Promise.reject(new Error('not used')),
      revokeSession: () => Promise.resolve(),
    },
    requests,
    reads: () => reads,
    transferChunk: async () => {
      await pullBody?.()
    },
    acceptUpload: (entry) => {
      sendAccepted?.(entry)
    },
  }
}

let i18n: I18nextInstance

beforeEach(() => {
  i18n = createI18n('en')
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPanel(api: ApiClient) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const services: AppServices = { api, queryClient, clearServerState: () => undefined }

  return render(
    <MantineProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <AppServicesContext.Provider value={services}>
            <CvVersionPanel variantId={VARIANT_ID} />
          </AppServicesContext.Provider>
        </QueryClientProvider>
      </I18nextProvider>
    </MantineProvider>,
  )
}

/** The whole-percent figure the progress surface is currently reporting (AC10). */
function reportedPercentage(): number {
  const text = screen.getByTestId('cv-version-upload-progress-text').textContent ?? ''
  const match = /(\d+)%/.exec(text)
  if (match?.[1] === undefined) {
    throw new Error(`no percentage in "${text}"`)
  }
  return Number.parseInt(match[1], 10)
}

// ── AC10 ──────────────────────────────────────────────────────────────────────

describe('the upload progress indicator (Req 11 AC10)', () => {
  it('reports the transferred byte percentage as the transport takes the body', async () => {
    const user = userEvent.setup()
    const stub = backend()
    const { container } = renderPanel(stub.api)

    await waitFor(() => {
      expect(screen.getByTestId('cv-version-upload')).toBeInTheDocument()
    })

    // 160 KB is transferred in three file chunks plus the multipart framing, so
    // the figure has somewhere to move between nothing sent and everything sent.
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    await user.upload(fileInput as HTMLInputElement, fileOf(160 * 1024))
    await user.click(screen.getByTestId('cv-version-upload-submit'))

    // In flight, with nothing yet handed to the transport.
    await waitFor(() => {
      expect(screen.getByTestId('cv-version-upload-progress')).toBeInTheDocument()
    })
    expect(reportedPercentage()).toBe(0)
    expect(screen.getByTestId('cv-version-upload-progress-text').textContent).toMatch(
      /[\d,]+ of [\d,]+ bytes/,
    )

    // Each pull moves the figure, and the indicator reports the same value it
    // renders as text.
    const seen: number[] = [0]
    for (let pulls = 0; pulls < 3; pulls += 1) {
      await stub.transferChunk()
      await waitFor(() => {
        expect(reportedPercentage()).toBeGreaterThan(seen[seen.length - 1] as number)
      })
      const percentage = reportedPercentage()
      expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute(
        'aria-valuenow',
        String(percentage),
      )
      seen.push(percentage)
    }

    expect(seen[seen.length - 1]).toBe(100)
    expect(seen.slice(1, -1).every((value) => value > 0 && value < 100)).toBe(true)

    // The 202 ends the transfer, so the indicator gives way to the outcome (AC11).
    stub.acceptUpload(version({ id: 'ver-1' }))
    await waitFor(() => {
      expect(screen.getByTestId('cv-version-upload-accepted')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('cv-version-upload-progress')).toBeNull()
  })
})

// ── AC12 ──────────────────────────────────────────────────────────────────────

describe('the scan poll (Req 11 AC12)', () => {
  it('re-reads the list while a version is PendingScan and stops once it is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const pending = version({ id: 'ver-1', version_number: 1 })
    const stub = backend({
      lists: [[pending], [pending], [{ ...pending, state: 'Available' }]],
    })
    renderPanel(stub.api)

    // The first answer holds a pending version, so the poll is running and says so.
    await waitFor(() => {
      expect(screen.getByTestId('cv-version-scan-polling')).toBeInTheDocument()
    })
    expect(stub.reads()).toBe(1)

    // AC12: at most ten seconds between reads.
    await vi.advanceTimersByTimeAsync(VERSION_POLL_INTERVAL_MS)
    await waitFor(() => {
      expect(stub.reads()).toBeGreaterThanOrEqual(2)
    })

    // The third answer resolves the scan.
    await vi.advanceTimersByTimeAsync(VERSION_POLL_INTERVAL_MS)
    await waitFor(() => {
      expect(screen.getByTestId('cv-version-state-1')).toHaveTextContent('Available')
    })
    expect(screen.queryByTestId('cv-version-scan-polling')).toBeNull()

    // AC12: and the poll stops there — the request count stops growing.
    const readsAtResolution = stub.reads()
    await vi.advanceTimersByTimeAsync(VERSION_POLL_INTERVAL_MS * 4)
    expect(stub.reads()).toBe(readsAtResolution)
  })

  it('polls no further once the Candidate leaves the screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const stub = backend({ lists: [[version({ id: 'ver-1' })]] })
    const { unmount } = renderPanel(stub.api)

    await waitFor(() => {
      expect(screen.getByTestId('cv-version-scan-polling')).toBeInTheDocument()
    })

    unmount()
    const readsAtDeparture = stub.reads()
    await vi.advanceTimersByTimeAsync(VERSION_POLL_INTERVAL_MS * 3)
    expect(stub.reads()).toBe(readsAtDeparture)
  })
})

// ── AC13, AC14 ────────────────────────────────────────────────────────────────

describe('download gating (Req 11 AC13, AC14)', () => {
  it('disables the control for a PendingScan version and states the reason', async () => {
    const stub = backend({ lists: [[version({ id: 'ver-1', version_number: 3 })]] })
    renderPanel(stub.api)

    const control = await screen.findByTestId('cv-version-download-3')
    expect(control).toBeDisabled()
    const reason = screen.getByTestId('cv-version-download-reason-3')
    expect(reason).toHaveTextContent('scan has not finished')
    expect(control).toHaveAttribute('aria-describedby', reason.id)
    // No download was issued, and none could be.
    expect(stub.requests.some((entry) => entry.path === CV_VERSION_DOWNLOAD_PATH)).toBe(false)
  })

  it('keeps a Quarantined version listed, marked, and refused with its reason', async () => {
    const stub = backend({
      lists: [
        [
          version({ id: 'ver-1', version_number: 1, state: 'Quarantined', original_filename: 'bad.pdf' }),
          version({ id: 'ver-2', version_number: 2, state: 'Available' }),
        ],
      ],
    })
    renderPanel(stub.api)

    await waitFor(() => {
      expect(screen.getByTestId('cv-version-1')).toBeInTheDocument()
    })
    // AC14: still in the list, with its filename, and named as quarantined.
    expect(screen.getByTestId('cv-version-filename-1')).toHaveTextContent('bad.pdf')
    expect(screen.getByTestId('cv-version-quarantined-1')).toBeInTheDocument()
    expect(screen.getByTestId('cv-version-download-1')).toBeDisabled()
    expect(screen.getByTestId('cv-version-download-reason-1')).toHaveTextContent('quarantined')
    // The sound version beside it is unaffected.
    expect(screen.getByTestId('cv-version-download-2')).toBeEnabled()
    expect(screen.queryByTestId('cv-version-download-reason-2')).toBeNull()
  })
})

// ── AC16 ──────────────────────────────────────────────────────────────────────

describe('downloading an Available version (Req 11 AC16)', () => {
  it('asks the download path and delivers the bytes under the original filename', async () => {
    const clicked: { download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download })
    })

    const user = userEvent.setup()
    const stub = backend({
      lists: [
        [
          version({
            id: 'ver-2',
            version_number: 2,
            state: 'Available',
            original_filename: 'السيرة الذاتية.pdf',
          }),
        ],
      ],
    })
    renderPanel(stub.api)

    await user.click(await screen.findByTestId('cv-version-download-2'))

    await waitFor(() => {
      expect(clicked).toHaveLength(1)
    })
    // AC16: the version's own filename, byte for byte (Req 19 AC10).
    expect(clicked[0]?.download).toBe('السيرة الذاتية.pdf')
    expect(
      stub.requests.filter((entry) => entry.path === CV_VERSION_DOWNLOAD_PATH),
    ).toEqual([
      {
        method: 'get',
        path: CV_VERSION_DOWNLOAD_PATH,
        pathParams: { variant_id: VARIANT_ID, version_number: 2 },
      },
    ])
  })
})
