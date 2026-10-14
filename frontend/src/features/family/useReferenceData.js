import { useCallback } from "react";
import { fetchJson } from "../../api";
import useScopedDataResource from "../shared/useScopedDataResource";


const EMPTY_CATEGORIES = Object.freeze([]);


export default function useReferenceData({
  dataScope,
  identityKey,
  loggedIn,
}) {
  const loadCategories = useCallback(
    () => fetchJson("/categories", { scope: dataScope }),
    [dataScope],
  );
  return {
    categories: useScopedDataResource({
      enabled: true,
      identityKey,
      initialValue: EMPTY_CATEGORIES,
      load: loadCategories,
      loggedIn,
    }),
  };
}
