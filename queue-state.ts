export type QueueLane = "steer" | "followUp";

export interface QueuedMessage<TImage = unknown> {
	id: string;
	lane: QueueLane;
	text: string;
	images: TImage[];
	sequence: number;
}

/**
 * Two independent FIFOs presented as one delivery-ordered timeline.
 *
 * Steering rows always appear before follow-ups because Pi consumes that lane
 * first. Sequence is global so queue editing can enter at the most recently
 * enqueued row even when that row sits in the middle of the visual timeline.
 */
export class DeliveryQueue<TImage = unknown> {
	private items: QueuedMessage<TImage>[] = [];
	private nextIdNumber = 1;
	private nextSequence = 1;

	enqueue(lane: QueueLane, text: string, images: readonly TImage[] = []): QueuedMessage<TImage> {
		const prefix = lane === "steer" ? "steer" : "follow-up";
		const item = {
			id: `${prefix}-${this.nextIdNumber++}`,
			lane,
			text,
			images: [...images],
			sequence: this.nextSequence++,
		};
		this.items.push(item);
		return this.copy(item);
	}

	prepend(item: QueuedMessage<TImage>): void {
		const firstInLane = this.items.findIndex((candidate) => candidate.lane === item.lane);
		if (firstInLane === -1) this.items.push(this.copy(item));
		else this.items.splice(firstInLane, 0, this.copy(item));
	}

	prependMany(items: readonly QueuedMessage<TImage>[]): void {
		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			if (item) this.prepend(item);
		}
	}

	update(id: string, text: string, images?: readonly TImage[]): boolean {
		const item = this.items.find((candidate) => candidate.id === id);
		if (!item) return false;
		item.text = text;
		if (images) item.images = [...images];
		return true;
	}

	/** Reclassify a row into the other lane, joining that lane's tail. */
	moveToLaneTail(id: string, lane: QueueLane): boolean {
		const index = this.items.findIndex((item) => item.id === id);
		if (index === -1) return false;
		const [item] = this.items.splice(index, 1);
		if (!item) return false;
		item.lane = lane;
		this.items.push(item);
		return true;
	}

	/** Apply a visual order while retaining any rows not present in the draft. */
	reorder(ids: readonly string[]): void {
		const byId = new Map(this.items.map((item) => [item.id, item]));
		const reordered: QueuedMessage<TImage>[] = [];
		for (const id of ids) {
			const item = byId.get(id);
			if (!item) continue;
			reordered.push(item);
			byId.delete(id);
		}
		for (const item of this.items) {
			if (byId.has(item.id)) reordered.push(item);
		}
		this.items = reordered;
	}

	remove(id: string): QueuedMessage<TImage> | undefined {
		const index = this.items.findIndex((item) => item.id === id);
		if (index === -1) return undefined;
		const [item] = this.items.splice(index, 1);
		return item ? this.copy(item) : undefined;
	}

	peek(lane: QueueLane): QueuedMessage<TImage> | undefined {
		const item = this.items.find((candidate) => candidate.lane === lane);
		return item ? this.copy(item) : undefined;
	}

	shift(lane: QueueLane): QueuedMessage<TImage> | undefined {
		const index = this.items.findIndex((item) => item.lane === lane);
		if (index === -1) return undefined;
		const [item] = this.items.splice(index, 1);
		return item ? this.copy(item) : undefined;
	}

	shiftAll(lane: QueueLane): QueuedMessage<TImage>[] {
		const removed = this.items.filter((item) => item.lane === lane).map((item) => this.copy(item));
		this.items = this.items.filter((item) => item.lane !== lane);
		return removed;
	}

	get(id: string): QueuedMessage<TImage> | undefined {
		const item = this.items.find((candidate) => candidate.id === id);
		return item ? this.copy(item) : undefined;
	}

	previousId(currentId?: string): string | undefined {
		const ordered = this.snapshot();
		if (ordered.length === 0) return undefined;
		if (!currentId) return this.mostRecentId();
		const index = ordered.findIndex((item) => item.id === currentId);
		if (index <= 0) return ordered.at(-1)?.id;
		return ordered[index - 1]?.id;
	}

	nextId(currentId?: string): string | undefined {
		const ordered = this.snapshot();
		if (ordered.length === 0) return undefined;
		if (!currentId) return this.mostRecentId();
		const index = ordered.findIndex((item) => item.id === currentId);
		if (index === -1 || index === ordered.length - 1) return ordered[0]?.id;
		return ordered[index + 1]?.id;
	}

	mostRecentId(): string | undefined {
		let newest: QueuedMessage<TImage> | undefined;
		for (const item of this.items) {
			if (!newest || item.sequence > newest.sequence) newest = item;
		}
		return newest?.id;
	}

	laneSnapshot(lane: QueueLane): QueuedMessage<TImage>[] {
		return this.items.filter((item) => item.lane === lane).map((item) => this.copy(item));
	}

	snapshot(): QueuedMessage<TImage>[] {
		return [...this.laneSnapshot("steer"), ...this.laneSnapshot("followUp")];
	}

	laneLength(lane: QueueLane): number {
		return this.items.filter((item) => item.lane === lane).length;
	}

	get length(): number {
		return this.items.length;
	}

	clear(): void {
		this.items = [];
	}

	private copy(item: QueuedMessage<TImage>): QueuedMessage<TImage> {
		return { ...item, images: [...item.images] };
	}
}

interface QueuedMessageDraft<TImage> {
	id: string;
	text: string;
	images: TImage[];
	lane: QueueLane;
	removed: boolean;
}

export interface EditCommitResult {
	updated: number;
	removed: number;
	moved: number;
}

/** Rollback-safe drafts spanning rows from either delivery lane. */
export class QueueEditSession<TImage = unknown> {
	private readonly drafts = new Map<string, QueuedMessageDraft<TImage>>();
	private readonly movedIds = new Set<string>();
	private currentId: string;
	private order: string[] | undefined;
	readonly composerDraft: string;

	constructor(item: QueuedMessage<TImage>, composerDraft: string) {
		this.currentId = item.id;
		this.composerDraft = composerDraft;
		this.drafts.set(item.id, this.newDraft(item));
	}

	private newDraft(item: QueuedMessage<TImage>): QueuedMessageDraft<TImage> {
		return { id: item.id, text: item.text, images: [...item.images], lane: item.lane, removed: false };
	}

	get selectedId(): string {
		return this.currentId;
	}

	get selectedText(): string {
		return this.drafts.get(this.currentId)?.text ?? "";
	}

	capture(text: string, images?: readonly TImage[]): void {
		const draft = this.drafts.get(this.currentId);
		if (!draft) return;
		draft.text = text;
		if (images) draft.images = [...images];
	}

	select(item: QueuedMessage<TImage>, currentText: string, images?: readonly TImage[]): string {
		this.capture(currentText, images);
		if (!this.drafts.has(item.id)) {
			this.drafts.set(item.id, this.newDraft(item));
		}
		this.currentId = item.id;
		return this.selectedText;
	}

	/** Toggle whether the row is deleted on save. Returns the new mark. */
	toggleRemoved(id: string): boolean | undefined {
		const draft = this.drafts.get(id);
		if (!draft) return undefined;
		draft.removed = !draft.removed;
		return draft.removed;
	}

	/** Toggle the row's draft delivery lane. Returns the new lane. */
	toggleLane(id: string): QueueLane | undefined {
		const draft = this.drafts.get(id);
		if (!draft) return undefined;
		draft.lane = draft.lane === "steer" ? "followUp" : "steer";
		return draft.lane;
	}

	/** Current visual order, including queued rows added after editing began. */
	orderedIds(queue: DeliveryQueue<TImage>): string[] {
		const current = queue.snapshot();
		const currentIds = new Set(current.map((item) => item.id));
		const order = (this.order ?? current.map((item) => item.id)).filter((id) => currentIds.has(id));
		const included = new Set(order);

		for (const item of current) {
			if (included.has(item.id)) continue;
			const lane = this.laneFor(item.id) ?? item.lane;
			let insertionIndex = -1;
			for (let index = 0; index < order.length; index += 1) {
				const orderedItem = queue.get(order[index]!);
				if (orderedItem && (this.laneFor(orderedItem.id) ?? orderedItem.lane) === lane) {
					insertionIndex = index + 1;
				}
			}
			if (insertionIndex === -1 && lane === "steer") {
				insertionIndex = order.findIndex((id) => {
					const orderedItem = queue.get(id);
					return orderedItem && (this.laneFor(id) ?? orderedItem.lane) === "followUp";
				});
			}
			if (insertionIndex === -1) insertionIndex = order.length;
			order.splice(insertionIndex, 0, item.id);
			included.add(item.id);
		}

		this.order = order;
		return [...order];
	}

	/**
	 * Move a row within its lane. Crossing a lane edge moves it into the
	 * adjacent lane at that boundary.
	 */
	move(id: string, direction: "previous" | "next", queue: DeliveryQueue<TImage>): boolean {
		const item = queue.get(id);
		if (!item) return false;
		let draft = this.drafts.get(id);
		if (!draft) {
			draft = this.newDraft(item);
			this.drafts.set(id, draft);
		}

		const order = this.orderedIds(queue);
		const laneForId = (candidateId: string): QueueLane | undefined => {
			const candidate = queue.get(candidateId);
			return candidate ? this.laneFor(candidateId) ?? candidate.lane : undefined;
		};
		const laneIds = order.filter((candidateId) => laneForId(candidateId) === draft.lane);
		const laneIndex = laneIds.indexOf(id);
		if (laneIndex === -1) return false;

		const adjacentId = direction === "previous" ? laneIds[laneIndex - 1] : laneIds[laneIndex + 1];
		if (adjacentId) {
			const from = order.indexOf(id);
			const to = order.indexOf(adjacentId);
			[order[from], order[to]] = [order[to]!, order[from]!];
			this.order = order;
			this.refreshMovedState(id, queue);
			return true;
		}

		if (direction === "previous" && draft.lane === "followUp") {
			draft.lane = "steer";
			this.refreshMovedState(id, queue);
			return true;
		}
		if (direction === "next" && draft.lane === "steer") {
			draft.lane = "followUp";
			this.refreshMovedState(id, queue);
			return true;
		}
		return false;
	}

	private refreshMovedState(id: string, queue: DeliveryQueue<TImage>): void {
		const item = queue.get(id);
		if (!item) {
			this.movedIds.delete(id);
			return;
		}
		const lane = this.laneFor(id) ?? item.lane;
		if (lane !== item.lane) {
			this.movedIds.add(id);
			return;
		}

		const committedLaneIds = queue.laneSnapshot(item.lane).map((candidate) => candidate.id);
		const draftLaneIds = this.orderedIds(queue).filter((candidateId) => {
			const candidate = queue.get(candidateId);
			return candidate && (this.laneFor(candidateId) ?? candidate.lane) === lane;
		});
		if (committedLaneIds.indexOf(id) === draftLaneIds.indexOf(id)) this.movedIds.delete(id);
		else this.movedIds.add(id);
	}

	laneFor(id: string): QueueLane | undefined {
		return this.drafts.get(id)?.lane;
	}

	hasMoved(id: string): boolean {
		return this.movedIds.has(id);
	}

	isRemoved(id: string): boolean {
		return this.drafts.get(id)?.removed ?? false;
	}

	touches(id: string): boolean {
		return this.drafts.has(id);
	}

	touchesLane(queue: DeliveryQueue<TImage>, lane: QueueLane): boolean {
		return queue.laneSnapshot(lane).some((item) => this.touches(item.id));
	}

	textFor(id: string): string | undefined {
		return this.drafts.get(id)?.text;
	}

	imagesFor(id: string): TImage[] | undefined {
		const images = this.drafts.get(id)?.images;
		return images ? [...images] : undefined;
	}

	hasChanges(queue: DeliveryQueue<TImage>, currentText = this.selectedText): boolean {
		const committedOrder = queue.snapshot().map((item) => item.id);
		const draftOrder = this.orderedIds(queue);
		if (
			committedOrder.length !== draftOrder.length ||
			committedOrder.some((id, index) => draftOrder[index] !== id)
		) {
			return true;
		}

		for (const draft of this.drafts.values()) {
			const item = queue.get(draft.id);
			if (!item) continue;
			const text = draft.id === this.currentId ? currentText : draft.text;
			if (draft.removed || draft.lane !== item.lane || text !== item.text) return true;
			if (
				draft.images.length !== item.images.length ||
				draft.images.some((image, index) => image !== item.images[index])
			) {
				return true;
			}
		}
		return false;
	}

	commit(
		queue: DeliveryQueue<TImage>,
		currentText: string,
		images?: readonly TImage[],
	): EditCommitResult {
		this.capture(currentText, images);
		let updated = 0;
		let removed = 0;
		let moved = 0;
		for (const draft of this.drafts.values()) {
			if (draft.removed || (!draft.text.trim() && draft.images.length === 0)) {
				if (queue.remove(draft.id)) removed += 1;
				continue;
			}
			if (queue.update(draft.id, draft.text, draft.images)) updated += 1;
		}
		// Apply lane moves in queue order so multi-row moves land at the
		// destination tail in the same order the timeline previewed them.
		for (const item of queue.snapshot()) {
			const draft = this.drafts.get(item.id);
			if (draft && !draft.removed && draft.lane !== item.lane) {
				if (queue.moveToLaneTail(item.id, draft.lane)) moved += 1;
			}
		}
		queue.reorder(this.orderedIds(queue));
		return { updated, removed, moved };
	}
}
