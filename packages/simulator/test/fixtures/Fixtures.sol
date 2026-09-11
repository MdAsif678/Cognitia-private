// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal, dependency-free test assets for simulator integration tests only.
// The real demo contracts live in /contracts (owned by the contracts workstream).

contract TestERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(n)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    // Like OpenZeppelin v5: spending an allowance emits no Approval event.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 current = allowance[from][msg.sender];
        require(current >= amount, "ERC20: insufficient allowance");
        if (current != type(uint256).max) allowance[from][msg.sender] = current - amount;
        _transfer(from, to, amount);
        return true;
    }

    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "PERMIT_EXPIRED");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline))
            )
        );
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "INVALID_SIGNATURE");
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract TestERC721 {
    string public name;
    string public symbol;

    constructor(string memory n, string memory s) {
        name = n;
        symbol = s;
    }
    mapping(uint256 => address) public ownerOf_;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(address => uint256[]) private owned;
    mapping(uint256 => uint256) private ownedIndex;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x780e9d63;
    }

    function ownerOf(uint256 id) public view returns (address o) {
        o = ownerOf_[id];
        require(o != address(0), "ERC721: nonexistent token");
    }

    function tokenOfOwnerByIndex(address o, uint256 i) external view returns (uint256) {
        return owned[o][i];
    }

    function mint(address to, uint256 id) external {
        require(ownerOf_[id] == address(0), "exists");
        _move(address(0), to, id);
    }

    function approve(address to, uint256 id) external {
        address o = ownerOf(id);
        require(msg.sender == o || isApprovedForAll[o][msg.sender], "ERC721: not authorized");
        getApproved[id] = to;
        emit Approval(o, to, id);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 id) public {
        require(ownerOf(id) == from, "ERC721: wrong owner");
        require(msg.sender == from || isApprovedForAll[from][msg.sender] || getApproved[id] == msg.sender, "ERC721: not authorized");
        _move(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external {
        transferFrom(from, to, id);
    }

    function _move(address from, address to, uint256 id) internal {
        if (from != address(0)) {
            uint256 last = owned[from][owned[from].length - 1];
            owned[from][ownedIndex[id]] = last;
            ownedIndex[last] = ownedIndex[id];
            owned[from].pop();
            balanceOf[from]--;
        }
        ownedIndex[id] = owned[to].length;
        owned[to].push(id);
        balanceOf[to]++;
        ownerOf_[id] = to;
        delete getApproved[id];
        emit Transfer(from, to, id);
    }
}

contract TestERC1155 {
    mapping(uint256 => mapping(address => uint256)) private balances;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);
    event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0xd9b67a26;
    }

    function balanceOf(address account, uint256 id) external view returns (uint256) {
        return balances[id][account];
    }

    function mint(address to, uint256 id, uint256 amount) external {
        balances[id][to] += amount;
        emit TransferSingle(msg.sender, address(0), to, id, amount);
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata) external {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "ERC1155: not authorized");
        require(balances[id][from] >= amount, "ERC1155: insufficient balance");
        balances[id][from] -= amount;
        balances[id][to] += amount;
        emit TransferSingle(msg.sender, from, to, id, amount);
    }

    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata) external {
        require(msg.sender == from || isApprovedForAll[from][msg.sender], "ERC1155: not authorized");
        require(ids.length == amounts.length, "ERC1155: length mismatch");
        for (uint256 i = 0; i < ids.length; i++) {
            require(balances[ids[i]][from] >= amounts[i], "ERC1155: insufficient balance");
            balances[ids[i]][from] -= amounts[i];
            balances[ids[i]][to] += amounts[i];
        }
        emit TransferBatch(msg.sender, from, to, ids, amounts);
    }
}

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// A "claim rewards" contract whose claim() actually drains a pre-existing allowance.
contract TestDrainer {
    address public immutable collector;

    constructor(address c) {
        collector = c;
    }

    function claim(address token) external {
        uint256 bal = IERC20Like(token).balanceOf(msg.sender);
        uint256 allowed = IERC20Like(token).allowance(msg.sender, address(this));
        IERC20Like(token).transferFrom(msg.sender, collector, bal < allowed ? bal : allowed);
    }

    function claimWithFee() external payable {
        (bool ok, ) = collector.call{value: msg.value}("");
        require(ok, "forward failed");
    }

    function claimClosed() external pure {
        revert("Rewards period has ended");
    }
}

/// Delegates every call to an implementation (to exercise DELEGATECALL tracing).
contract TestDelegator {
    address public immutable impl;

    constructor(address i) {
        impl = i;
    }

    fallback() external payable {
        (bool ok, bytes memory ret) = impl.delegatecall(msg.data);
        require(ok, "delegatecall failed");
        assembly {
            return(add(ret, 32), mload(ret))
        }
    }
}
