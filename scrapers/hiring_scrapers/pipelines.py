from itemadapter import ItemAdapter
from scrapy.exceptions import DropItem


class UniqueJobPipeline:
    def open_spider(self, spider):
        self.keys = set()

    def process_item(self, item, spider):
        adapter = ItemAdapter(item)
        key = "|".join(
            str(adapter.get(field) or "").strip().lower()
            for field in ["external_id", "source", "title", "location", "url"]
        )
        if key in self.keys:
            raise DropItem("repeated crawler item")
        self.keys.add(key)
        return item
