// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IMailboxWithdrawFee {
    function withdrawFee() external;
}

contract MailboxTreasuryMock {

    bool public canReceive;

    address internal mailbox;

    constructor(address _mailbox) {
        mailbox = _mailbox;
        canReceive = true;
    }

    function withdrawFee() external {
        IMailboxWithdrawFee(mailbox).withdrawFee();
    }

    function enableReceive() external {
        canReceive = true;
    }

    function disableReceive() external {
        canReceive = false;
    }

    receive() external payable {
        require(canReceive == true, "Receive disabled");
    }
}