import { queryParametersGenerator } from './query-parameters-generator'
import {
  BulkRequest,
  BulkResponse,
  CountRequest,
  CountResponse,
  DeleteByQueryRequest,
  DeleteByQueryResponse,
  DeleteRequest,
  DeleteResponse,
  GetRequest,
  GetResponse,
  IndexRequest,
  IndexResponse,
  IndicesCreateRequest,
  IndicesCreateResponse,
  IndicesRefreshRequest,
  IndicesRefreshResponse,
  SearchRequest,
  SearchResponse,
  UpdateByQueryRequest,
  UpdateByQueryResponse,
  UpdateRequest,
  UpdateResponse,
} from './types'

const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
}

interface Response<T> {
  data: T | null
  code: number
  error?: Error
}

export interface Authorization {
  username: string
  password: string
}
export interface ClientOptions {
  hosts: string[]
  customHeaders?: Record<string, string>
  /**
   * Authorization for elasticsearch
   */
  authorization?: Authorization
  /**
   * When you want to use your own fetch function or polyfill
   */
  fetch?: typeof fetch
}

interface CustomUrl extends URL {
  headers: Record<string, string>
  Authorization?: string
}

export class ElasticClient {
  readonly #hosts: CustomUrl[]
  readonly #headers = HEADERS
  readonly #authorization?: Authorization
  readonly #fetch = fetch

  constructor(options: ClientOptions) {
    this.#hosts = options.hosts.map((host) => {
      const url: CustomUrl = new URL(host) as CustomUrl
      if (url.password && url.username) {
        url.Authorization = this.getAuthorizationValue({
          username: url.username,
          password: url.password,
        })
      }
      return url
    })
    this.#headers = options.customHeaders ? { ...HEADERS, ...options.customHeaders } : HEADERS
    this.#authorization = options.authorization

    if (this.#authorization) {
      this.#headers.Authorization = this.getAuthorizationValue({
        username: this.#authorization.username,
        password: this.#authorization.password,
      })
    }

    if (options.fetch) {
      this.#fetch = options.fetch
    }
  }

  private async fetch<T>(
    urlWithoutHost: string,
    options: RequestInit,
    retries: number = 1
  ): Promise<Response<T>> {
    let error: Error | undefined

    let code = 500
    for (let index = 0; index < retries; index++) {
      const host = this.#hosts[Math.floor(Math.random() * this.#hosts.length)]

      if (host.Authorization) {
        options.headers = {
          ...options.headers,
          Authorization: host.Authorization,
        }
      }
      const fetchUrl = `${host.protocol}//${host.host}${urlWithoutHost}`

      try {
        const response = await this.#fetch(fetchUrl, options)
        code = response.status
        if (response.ok) {
          return { code, data: await response.json() }
        } else {
          error = new Error(
            `Elasticsearch request failed: ${fetchUrl} with status ${
              response.status
            } ${await response.text()}`
          )
        }
      } catch (error_) {
        if (error_ instanceof Error) {
          error = error_
        }
      }
    }

    return { code, error, data: null }
  }

  getAuthorizationValue(authorization: Authorization): string {
    return `Basic ${Buffer.from(`${authorization.username}:${authorization.password}`).toString(
      'base64'
    )}`
  }

  async search<T>(params: SearchRequest): Promise<Response<SearchResponse<T>>> {
    let url = `/${params.index}/${params.version ? `${params.version}/` : ''}_search`
    const queryParams = queryParametersGenerator(
      {
        allow_no_indices: params.allow_no_indices,
        allow_partial_search_results: params.allow_partial_search_results,
        analyzer: params.analyzer,
        analyze_wildcard: params.analyze_wildcard,
        batched_reduce_size: params.batched_reduce_size,
        ccs_minimize_roundtrips: params.ccs_minimize_roundtrips,
        default_operator: params.default_operator,
        df: params.df,
        docvalue_fields: params.docvalue_fields,
        expand_wildcards: params.expand_wildcards,
        explain: params.explain,
        ignore_throttled: params.ignore_throttled,
        ignore_unavailable: params.ignore_unavailable,
        lenient: params.lenient,
        max_concurrent_shard_requests: params.max_concurrent_shard_requests,
        preference: params.preference,
        q: params.q,
        request_cache: params.request_cache,
        rest_total_hits_as_int: params.rest_total_hits_as_int,
        routing: params.routing,
        pretty: params.pretty,
        version: params.version,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    delete params.version
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params),
    })
  }

  async get<T>(params: GetRequest): Promise<Response<GetResponse<T>>> {
    let url = `/${params.index}/_doc/${params.id}`

    const queryParams = queryParametersGenerator(
      {
        preference: params.preference,
        realtime: params.realtime,
        refresh: params.refresh,
        routing: params.routing,
        _source: params._source,
        stored_fields: params.stored_fields,
        version: params.version,
        version_type: params.version_type,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }

    return await this.fetch(url, {
      method: 'GET',
      headers: this.#headers,
    })
  }

  async createIndex(params: IndicesCreateRequest): Promise<Response<IndicesCreateResponse>> {
    let url = `/${params.index}`

    const queryParams = queryParametersGenerator(
      {
        wait_for_active_shards: params.wait_for_active_shards,
        timeout: params.timeout,
        master_timeout: params.master_timeout,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    return await this.fetch(url, {
      method: 'PUT',
      headers: this.#headers,
      body: JSON.stringify(params),
    })
  }

  async index<T>(params: IndexRequest<T>): Promise<Response<IndexResponse>> {
    let url = `/${params.index}/${params.version_type ? params.version_type + '/' : ''}_doc${
      params.id ? `/${params.id}` : ''
    }`

    const queryParams = queryParametersGenerator(
      {
        if_seq_no: params.if_seq_no,
        if_primary_term: params.if_primary_term,
        op_type: params.op_type,
        pipeline: params.pipeline,
        refresh: params.refresh,
        routing: params.routing,
        timeout: params.timeout,
        version: params.version,
        version_type: params.version_type,
        wait_for_active_shards: params.wait_for_active_shards,
        require_alias: params.require_alias,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params.document),
    })
  }

  async update<T>(params: UpdateRequest<T>): Promise<Response<UpdateResponse<T>>> {
    let url = `/${params.index}/_update${params.id ? `/${params.id}` : ''}`

    const queryParams = queryParametersGenerator(
      {
        if_seq_no: params.if_seq_no,
        if_primary_term: params.if_primary_term,
        lang: params.lang,
        require_alias: params.require_alias,
        refresh: params.refresh,
        retry_on_conflict: params.retry_on_conflict,
        routing: params.routing,
        _source: params._source,
        _source_excludes: params._source_excludes,
        _source_includes: params._source_includes,
        timeout: params.timeout,
        wait_for_active_shards: params.wait_for_active_shards,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.id
    delete params.index
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params),
    })
  }

  async updateByQuery(params: UpdateByQueryRequest): Promise<Response<UpdateByQueryResponse>> {
    let url = `/${params.index}/_update_by_query`

    const queryParams = queryParametersGenerator(
      {
        allow_no_indices: params.allow_no_indices,
        analyzer: params.analyzer,
        conflicts: 'proceed' ?? params.conflicts,
        analyze_wildcard: params.analyze_wildcard,
        default_operator: params.default_operator,
        df: params.df,
        expand_wildcards: params.expand_wildcards,
        from: params.from,
        ignore_unavailable: params.ignore_unavailable,
        lenient: params.lenient,
        max_docs: params.max_docs,
        pipeline: params.pipeline,
        preference: params.preference,
        refresh: params.refresh,
        request_cache: params.request_cache,
        requests_per_second: params.requests_per_second,
        routing: params.routing,
        scroll: params.scroll,
        scroll_size: params.scroll_size,
        search_timeout: params.search_timeout,
        search_type: params.search_type,
        slices: params.slices,
        sort: params.sort,
        stats: params.stats,
        terminate_after: params.terminate_after,
        timeout: params.timeout,
        version: params.version,
        version_type: params.version_type,
        wait_for_active_shards: params.wait_for_active_shards,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params),
    })
  }

  async deleteIndex({ index }: { index: string }): Promise<Response<null>> {
    const url = `/${index}`

    return await this.fetch(url, {
      method: 'DELETE',
      headers: this.#headers,
    })
  }

  async delete(params: DeleteRequest): Promise<Response<DeleteResponse>> {
    let url = `/${params.index}/_doc/${params.id}`

    const queryParams = queryParametersGenerator(
      {
        id: params.id,
        index: params.index,
        if_primary_term: params.if_primary_term,
        if_seq_no: params.if_seq_no,
        refresh: params.refresh,
        routing: params.routing,
        timeout: params.timeout,
        version: params.version,
        version_type: params.version_type,
        wait_for_active_shards: params.wait_for_active_shards,
      },
      params
    )
    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    return await this.fetch(url, {
      method: 'DELETE',
      headers: this.#headers,
    })
  }

  async deleteByQuery(params: DeleteByQueryRequest): Promise<Response<DeleteByQueryResponse>> {
    let url = `/${params.index}/_delete_by_query`

    const queryParams = queryParametersGenerator(
      {
        allow_no_indices: params.allow_no_indices,
        analyzer: params.analyzer,
        conflicts: 'proceed' ?? params.conflicts,
        analyze_wildcard: params.analyze_wildcard,
        default_operator: params.default_operator,
        df: params.df,
        expand_wildcards: params.expand_wildcards,
        from: params.from,
        ignore_unavailable: params.ignore_unavailable,
        lenient: params.lenient,
        max_docs: params.max_docs,
        preference: params.preference,
        refresh: params.refresh,
        request_cache: params.request_cache,
        requests_per_second: params.requests_per_second,
        routing: params.routing,
        scroll: params.scroll,
        scroll_size: params.scroll_size,
        search_timeout: params.search_timeout,
        search_type: params.search_type,
        slices: params.slices,
        sort: params.sort,
        stats: params.stats,
        terminate_after: params.terminate_after,
        timeout: params.timeout,
        version: params.version,
        wait_for_active_shards: params.wait_for_active_shards,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params),
    })
  }

  async refreshIndex(params: IndicesRefreshRequest): Promise<Response<IndicesRefreshResponse>> {
    let url = `/${params.index}/_refresh`

    const queryParams = queryParametersGenerator(
      {
        allow_no_indices: params.allow_no_indices,
        expand_wildcards: params.expand_wildcards,
        ignore_unavailable: params.ignore_unavailable,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
    })
  }

  async countIndex(params: CountRequest): Promise<Response<CountResponse>> {
    let url = `/${params.index}/_count`

    const queryParams = queryParametersGenerator(
      {
        allow_no_indices: params.allow_no_indices,
        analyzer: params.analyzer,
        analyze_wildcard: params.analyze_wildcard,
        default_operator: params.default_operator,
        df: params.df,
        expand_wildcards: params.expand_wildcards,
        ignore_throttled: params.ignore_throttled,
        ignore_unavailable: params.ignore_unavailable,
        lenient: params.lenient,
        min_score: params.min_score,
        preference: params.preference,
        q: params.q,
        routing: params.routing,
        terminate_after: params.terminate_after,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index
    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: JSON.stringify(params),
    })
  }

  async bulk<T>(params: BulkRequest<T>): Promise<Response<BulkResponse>> {
    let url = `/_bulk`

    const queryParams = queryParametersGenerator(
      {
        pipeline: params.pipeline,
        refresh: params.refresh,
        require_alias: params.require_alias,
        routing: params.routing,
        _source: params._source,
        _source_excludes: params._source_excludes,
        _source_includes: params._source_includes,
        timeout: params.timeout,
        wait_for_active_shards: params.wait_for_active_shards,
      },
      params
    )

    if (queryParams) {
      url += `?${queryParams}`
    }
    delete params.index

    return await this.fetch(url, {
      method: 'POST',
      headers: this.#headers,
      body: params.body.map((item) => JSON.stringify(item)).join('\n') + '\n',
    })
  }
}
