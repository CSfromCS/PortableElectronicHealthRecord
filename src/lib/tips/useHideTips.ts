import { useSyncExternalStore } from 'react'
import { getHideTipsSnapshot, subscribeHideTips } from './tipsVisibility'

export const useHideTips = () => useSyncExternalStore(subscribeHideTips, getHideTipsSnapshot)
