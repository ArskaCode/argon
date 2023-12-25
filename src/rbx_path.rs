use serde::{Serialize, Serializer};
use std::{
	fmt::{self, Debug, Display},
	ops::Index,
};

const RBX_SEPARATOR: char = '/';

#[derive(Clone, PartialEq, Eq, Hash)]
pub struct RbxPath {
	components: Vec<String>,
}

impl RbxPath {
	pub fn new() -> Self {
		Self { components: vec![] }
	}

	pub fn from(path: &str) -> Self {
		let mut components = vec![];

		for component in path.split(RBX_SEPARATOR) {
			components.push(component.to_owned());
		}

		Self { components }
	}

	pub fn push(&mut self, path: &str) {
		if path.is_empty() {
			return;
		}

		self.components.push(path.to_owned());
	}

	pub fn pop(&mut self) -> Option<String> {
		self.components.pop()
	}

	pub fn len(&self) -> usize {
		self.components.len()
	}

	pub fn is_empty(&self) -> bool {
		self.components.is_empty()
	}

	pub fn iter(&self) -> impl Iterator<Item = &String> {
		self.components.iter()
	}

	pub fn first(&self) -> Option<&String> {
		self.components.first()
	}

	pub fn last(&self) -> Option<&String> {
		self.components.last()
	}
}

impl Index<usize> for RbxPath {
	type Output = String;

	fn index(&self, index: usize) -> &Self::Output {
		&self.components[index]
	}
}

impl Serialize for RbxPath {
	fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		serializer.serialize_str(&self.to_string())
	}
}

impl Display for RbxPath {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.components.join(&RBX_SEPARATOR.to_string()))
	}
}

impl Debug for RbxPath {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.components.join(&RBX_SEPARATOR.to_string()))
	}
}