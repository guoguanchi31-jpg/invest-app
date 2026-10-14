import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, isStaleRequestError } from "./api";

const EMPTY_ALIASES = Object.freeze({});

export default function usePaginatedResource({
  dataScope,
  endpoint,
  filterAliases = EMPTY_ALIASES,
  identityKey,
  pageSize,
  withSummary = false,
}) {
  const latestRequestRef = useRef(null);
  const latestIdentityKeyRef = useRef(identityKey);
  latestIdentityKeyRef.current = identityKey;
  const [response, setResponse] = useState({
    identityKey,
    scope: dataScope,
    datasetKey: null,
    queryKey: null,
    items: [],
    meta: {
      page: 1,
      page_size: pageSize,
      total: 0,
      ...(withSummary ? { summary: null } : {}),
    },
  });
  const [request, setRequest] = useState({
    identityKey,
    loading: false,
    error: "",
    filters: null,
  });

  useEffect(() => () => {
    latestRequestRef.current = null;
  }, []);

  const loadPage = useCallback(async (filters = {}) => {
    const requestToken = {};
    latestRequestRef.current = requestToken;
    const requestedIdentityKey = identityKey;
    const normalizedFilters = Object.fromEntries(
      Object.entries(filters).flatMap(([key, value]) => {
        if (value === undefined || value === null || value === "" || value === "all") return [];
        return [[filterAliases[key] || key, String(value)]];
      }),
    );
    const query = new URLSearchParams({
      page: String(filters.page || 1),
      page_size: String(pageSize),
      ...normalizedFilters,
    });
    const datasetKey = JSON.stringify(
      Object.entries(normalizedFilters)
        .filter(([key]) => !["page", "page_size"].includes(key))
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    const queryKey = query.toString();
    const requestedPage = Number(filters.page || 1);
    setResponse((current) => {
      const sameScope = current.identityKey === requestedIdentityKey
        && current.scope === dataScope;
      if (sameScope && current.queryKey === queryKey) return current;
      const sameDataset = sameScope && current.datasetKey === datasetKey;
      return {
        identityKey: requestedIdentityKey,
        scope: dataScope,
        datasetKey,
        queryKey,
        items: [],
        meta: {
          page: requestedPage,
          page_size: pageSize,
          total: sameDataset ? current.meta.total : 0,
          ...(withSummary ? {
            summary: sameDataset ? current.meta.summary : null,
          } : {}),
        },
      };
    });
    setRequest({
      identityKey: requestedIdentityKey,
      loading: true,
      error: "",
      filters: normalizedFilters,
    });
    try {
      const result = await fetchJson(
        `${endpoint}?${query.toString()}`,
        { scope: dataScope },
      );
      if (
        requestToken !== latestRequestRef.current
        || requestedIdentityKey !== latestIdentityKeyRef.current
      ) {
        return null;
      }
      setResponse({
        identityKey: requestedIdentityKey,
        scope: dataScope,
        datasetKey,
        queryKey,
        items: result.items || [],
        meta: {
          page: result.page,
          page_size: result.page_size,
          total: result.total,
          ...(withSummary ? { summary: result.summary } : {}),
        },
      });
      setRequest({
        identityKey: requestedIdentityKey,
        loading: false,
        error: "",
        filters: normalizedFilters,
      });
      return result;
    } catch (error) {
      if (
        requestToken === latestRequestRef.current
        && requestedIdentityKey === latestIdentityKeyRef.current
        && !isStaleRequestError(error)
      ) {
        setRequest({
          identityKey: requestedIdentityKey,
          loading: false,
          error: error.message || "加载失败",
          filters: normalizedFilters,
        });
      }
      return null;
    }
  }, [dataScope, endpoint, filterAliases, identityKey, pageSize, withSummary]);

  const isCurrentScope = (
    response.scope === dataScope
    && response.identityKey === identityKey
  );
  return {
    items: isCurrentScope ? response.items : [],
    meta: isCurrentScope ? response.meta : {
      page: 1,
      page_size: pageSize,
      total: 0,
      ...(withSummary ? { summary: null } : {}),
    },
    request: request.identityKey === identityKey
      ? request
      : { identityKey, loading: false, error: "", filters: null },
    loadPage,
  };
}
