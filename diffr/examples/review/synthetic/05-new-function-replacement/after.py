def main():
    return 1


def enqueue(items, queue):
    for item in items:
        if item is None:
            continue
        queue.append(item)
