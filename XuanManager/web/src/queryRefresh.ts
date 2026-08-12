import { useCallback, useState } from "react";

export function useQueryRefresh() {
  const [queryRevision, setQueryRevision] = useState(0);
  const refreshQuery = useCallback(() => setQueryRevision((value) => value + 1), []);
  return [queryRevision, refreshQuery] as const;
}
