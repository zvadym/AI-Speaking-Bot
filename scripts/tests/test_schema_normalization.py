import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('schema_normalization', Path(__file__).resolve().parents[1] / 'schema_normalization.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SchemaNormalizationTest(unittest.TestCase):
    def test_internal_versions_do_not_change_the_schema_snapshot(self):
        before = 'CREATE TABLE public.words (id bigint);\n'
        first = before + 'ALTER TABLE ONLY public.words ALTER COLUMN id SET (pg_attver=27343880);\n'
        second = before + 'ALTER TABLE ONLY public.words ALTER COLUMN id SET (pg_attver=99999999);\n'
        self.assertEqual(module.normalize_schema(first), before)
        self.assertEqual(module.normalize_schema(second), before)

    def test_real_column_options_constraints_and_comments_are_preserved(self):
        ddl = '''ALTER TABLE ONLY public.words ALTER COLUMN id SET STATISTICS 100;
ALTER TABLE ONLY public.words ALTER COLUMN id SET (n_distinct=10);
ALTER TABLE ONLY public.words ADD CONSTRAINT words_pkey PRIMARY KEY (id);
-- ALTER TABLE ONLY public.words ALTER COLUMN id SET (pg_attver=123);
'''
        self.assertEqual(module.normalize_schema(ddl), ddl)

    def test_quoted_identifiers_are_supported(self):
        self.assertEqual(module.normalize_schema('ALTER TABLE ONLY "My schema"."My table" ALTER COLUMN "My column" SET (pg_attver=12);\n'), '')
