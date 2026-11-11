import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../api';

// Loads a paginated list from the backend. Reloads automatically when `params` change.
export default function usePagedList(path, params) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const reqId = useRef(0);
  const key = JSON.stringify(params);

  const fetchPage = useCallback(async (p, mode) => {
    const id = ++reqId.current; // ignore stale responses
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'more') setLoadingMore(true);
    try {
      const r = await api.get(path, { params: { ...params, page: p, limit: 20 } });
      if (id !== reqId.current) return;
      const d = r.data.data;
      setItems((prev) => (p === 1 ? d.items : [...prev, ...d.items]));
      setPage(d.page);
      setTotalPages(d.total_pages);
      setTotal(d.total);
      setError('');
    } catch (e) {
      if (id !== reqId.current) return;
      setError(errMsg(e));
    } finally {
      if (id === reqId.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);

  useEffect(() => { fetchPage(1, 'initial'); }, [fetchPage]);

  const ref = useRef(fetchPage);
  ref.current = fetchPage;
  const silentReload = useCallback(() => ref.current(1, 'silent'), []); // stable: used on screen focus

  return {
    items, total, loading, refreshing, loadingMore, error,
    reload: () => fetchPage(1, 'initial'),
    refresh: () => fetchPage(1, 'refresh'),
    silentReload,
    loadMore: () => { if (!loading && !loadingMore && page < totalPages) fetchPage(page + 1, 'more'); },
  };
}
