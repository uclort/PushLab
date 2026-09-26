import type { DeviceTokenHistoryItem, PayloadHistoryItem } from "../shared/types";

export function prependPayloadHistory(
	item: PayloadHistoryItem,
	history: PayloadHistoryItem[],
): PayloadHistoryItem[] {
	const existingIndex = history.findIndex((entry) => entry.payload === item.payload);
	if (existingIndex >= 0) {
		const existing = history[existingIndex]!;
		const updated = { ...existing, ...item, id: existing.id };
		return [updated, ...history.filter((_, index) => index !== existingIndex)].slice(0, 50);
	}
	return [item, ...history].slice(0, 50);
}

export function prependDeviceTokenHistory(
	item: DeviceTokenHistoryItem,
	history: DeviceTokenHistoryItem[],
): DeviceTokenHistoryItem[] {
	const existingIndex = history.findIndex((entry) => entry.token === item.token);
	if (existingIndex >= 0) {
		const existing = history[existingIndex]!;
		const updated = { ...existing, ...item, id: existing.id };
		return [updated, ...history.filter((_, index) => index !== existingIndex)].slice(0, 10);
	}
	return [item, ...history].slice(0, 10);
}
