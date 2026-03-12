import textwrap
import unittest

from scripts.compose_yaml import strip_service_ports_and_container_names


class StripServicePortsAndContainerNamesTest(unittest.TestCase):
    def test_preserves_scalar_service_keys_after_ports(self) -> None:
        compose_text = textwrap.dedent(
            """\
            services:
              app:
                image: example/app:latest
                ports:
                  - "3000:3000"
                restart: always
                working_dir: /app/sigil
                environment:
                  FOO: bar
            """,
        )

        actual = strip_service_ports_and_container_names(compose_text)

        self.assertNotIn('      - "3000:3000"', actual)
        self.assertIn("    restart: always", actual)
        self.assertIn("    working_dir: /app/sigil", actual)
        self.assertIn("    environment:", actual)

    def test_strips_container_name_and_entire_ports_block(self) -> None:
        compose_text = textwrap.dedent(
            """\
            services:
              app:
                container_name: app-fixed
                ports:
                  - "3000:3000"
                  - target: 4318
                    published: "4318"
                profiles:
                  - core
            """,
        )

        actual = strip_service_ports_and_container_names(compose_text)

        self.assertNotIn("container_name:", actual)
        self.assertNotIn('      - "3000:3000"', actual)
        self.assertNotIn('    published: "4318"', actual)
        self.assertIn("    profiles:", actual)


if __name__ == "__main__":
    unittest.main()
